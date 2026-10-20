use serde_json::Value;

use super::llm::{WhisperResponse, WhisperSegment};
use crate::models::meeting::Segment;

/// Longest segment kept whole; longer paragraphs are split so a chunk can always hold one.
const MAX_SEGMENT_CHARS: usize = 3_000;

/// Recomputes `index` and `char_offset` (offsets in the text joined with "\n").
pub fn renumber(segments: &mut [Segment]) {
    let mut offset = 0u32;
    for (i, segment) in segments.iter_mut().enumerate() {
        segment.index = i as u32;
        segment.char_offset = offset;
        offset += segment.text.chars().count() as u32 + 1;
    }
}

/// One segment per paragraph of uploaded text. Whitespace inside a paragraph is collapsed.
pub fn segments_from_text(text: &str) -> Vec<Segment> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut segments = Vec::new();
    for paragraph in normalized.split("\n\n") {
        let collapsed = paragraph
            .lines()
            .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if collapsed.is_empty() {
            continue;
        }
        for piece in split_long(&collapsed) {
            segments.push(Segment {
                index: 0,
                speaker: None,
                start_sec: None,
                end_sec: None,
                text: piece,
                char_offset: 0,
            });
        }
    }
    renumber(&mut segments);
    segments
}

/// Splits text over `MAX_SEGMENT_CHARS` at line breaks, then at sentence ends, then hard.
fn split_long(text: &str) -> Vec<String> {
    if text.chars().count() <= MAX_SEGMENT_CHARS {
        return vec![text.to_string()];
    }
    let mut pieces = Vec::new();
    let mut current = String::new();
    for unit in text.split_inclusive(['\n', '.', '!', '?']) {
        if current.chars().count() + unit.chars().count() > MAX_SEGMENT_CHARS && !current.trim().is_empty() {
            pieces.push(current.trim().to_string());
            current.clear();
        }
        current.push_str(unit);
        while current.chars().count() > MAX_SEGMENT_CHARS {
            let head: String = current.chars().take(MAX_SEGMENT_CHARS).collect();
            let rest: String = current.chars().skip(MAX_SEGMENT_CHARS).collect();
            pieces.push(head.trim().to_string());
            current = rest;
        }
    }
    if !current.trim().is_empty() {
        pieces.push(current.trim().to_string());
    }
    pieces
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerSpan {
    pub name: String,
    pub start: f32,
    pub end: f32,
}

/// Reads Recall's speaker timeline download
pub fn parse_speaker_timeline(data: &Value) -> Vec<SpeakerSpan> {
    let entries = data.as_array().map(Vec::as_slice).unwrap_or_default();
    let starts: Vec<Option<f32>> = entries
        .iter()
        .map(|e| e["start_timestamp"]["relative"].as_f64().map(|s| s as f32))
        .collect();
    let mut spans = Vec::new();
    for (i, entry) in entries.iter().enumerate() {
        let (Some(name), Some(start)) = (
            entry["participant"]["name"].as_str().map(str::trim).filter(|n| !n.is_empty()),
            starts[i],
        ) else {
            continue;
        };
        let end = entry["end_timestamp"]["relative"]
            .as_f64()
            .map(|e| e as f32)
            .or_else(|| starts[i + 1..].iter().flatten().next().copied())
            .unwrap_or(f32::MAX);
        if end > start {
            spans.push(SpeakerSpan { name: name.to_string(), start, end });
        }
    }
    spans
}

pub fn assign_speakers(segments: &mut [Segment], spans: &[SpeakerSpan]) {
    for segment in segments.iter_mut() {
        let (Some(start), Some(end)) = (segment.start_sec, segment.end_sec) else {
            continue;
        };
        let length = (end - start).max(0.1);
        let mut totals: Vec<(&str, f32)> = Vec::new();
        for span in spans {
            let overlap = end.min(span.end) - start.max(span.start);
            if overlap <= 0.0 {
                continue;
            }
            match totals.iter_mut().find(|(n, _)| *n == span.name) {
                Some((_, total)) => *total += overlap,
                None => totals.push((&span.name, overlap)),
            }
        }
        segment.speaker = totals
            .into_iter()
            .filter(|(_, total)| *total >= length * 0.25)
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(name, _)| name.to_string());
    }
}

fn is_hallucination(segment: &WhisperSegment) -> bool {
    let silent = segment.no_speech_prob.unwrap_or(0.0) > 0.6 && segment.avg_logprob.unwrap_or(0.0) < -1.0;
    let looping = segment.compression_ratio.unwrap_or(0.0) > 2.6;
    silent || looping
}

pub fn segments_from_asr(parts: &[(f32, &WhisperResponse)]) -> Vec<Segment> {
    let mut segments: Vec<Segment> = Vec::new();
    for (offset, response) in parts {
        for s in &response.segments {
            let text = s.text.split_whitespace().collect::<Vec<_>>().join(" ");
            if text.is_empty() || is_hallucination(s) {
                continue;
            }
            // Whisper sometimes repeats a line across a boundary; keep one.
            if segments.last().is_some_and(|prev| prev.text == text) {
                continue;
            }
            segments.push(Segment {
                index: 0,
                speaker: None,
                start_sec: Some(offset + s.start),
                end_sec: Some(offset + s.end),
                text,
                char_offset: 0,
            });
        }
    }
    renumber(&mut segments);
    segments
}

/// `mm:ss`, or `h:mm:ss` past the hour.
pub fn format_timestamp(seconds: f32) -> String {
    let total = seconds.max(0.0) as u32;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

/// One line as the model sees it: `[mm:ss] Speaker: text`, `[mm:ss] text` or plain text.
pub fn format_segment(segment: &Segment) -> String {
    let mut line = String::new();
    if let Some(start) = segment.start_sec {
        line.push('[');
        line.push_str(&format_timestamp(start));
        line.push_str("] ");
    }
    if let Some(speaker) = segment.speaker.as_deref().filter(|s| !s.is_empty()) {
        line.push_str(speaker);
        line.push_str(": ");
    }
    line.push_str(&segment.text);
    line
}

pub fn format_segments(segments: &[Segment]) -> String {
    segments.iter().map(format_segment).collect::<Vec<_>>().join("\n")
}

/// The full plain text (segments joined with "\n"), matching `char_offset`.
pub fn plain_text(segments: &[Segment]) -> String {
    segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join("\n")
}

/// The first `head` and last `tail` characters, joined with "[...]" when something is cut.
pub fn head_tail_sample(text: &str, head: usize, tail: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= head + tail {
        return text.to_string();
    }
    let start: String = chars[..head].iter().collect();
    let end: String = chars[chars.len() - tail..].iter().collect();
    format!("{start}\n[...]\n{end}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn text_becomes_one_segment_per_paragraph_with_offsets() {
        let segments = segments_from_text("Rapat mingguan\r\n\r\nBudi   akan kirim\nlaporan Jumat.\n\n\n  \nSelesai.");
        let texts: Vec<_> = segments.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["Rapat mingguan", "Budi akan kirim\nlaporan Jumat.", "Selesai."]);
        assert_eq!(segments[1].char_offset, 15);
        assert_eq!(segments[2].index, 2);
        let joined = plain_text(&segments);
        let offset = segments[2].char_offset as usize;
        assert_eq!(joined.chars().skip(offset).collect::<String>(), "Selesai.");
    }

    #[test]
    fn long_paragraphs_are_split_below_the_limit() {
        let sentence = "Kami membahas rencana rilis dan pembagian tugas tim. ";
        let text = sentence.repeat(200);
        let segments = segments_from_text(&text);
        assert!(segments.len() > 1);
        assert!(segments.iter().all(|s| s.text.chars().count() <= MAX_SEGMENT_CHARS));
        let rejoined: String = segments.iter().map(|s| s.text.replace(' ', "")).collect();
        assert_eq!(rejoined, text.replace(' ', ""));
    }

    fn whisper(segments: &[(f32, f32, &str)]) -> WhisperResponse {
        WhisperResponse {
            language: Some("indonesian".into()),
            duration: None,
            segments: segments
                .iter()
                .map(|(start, end, text)| WhisperSegment {
                    start: *start,
                    end: *end,
                    text: text.to_string(),
                    avg_logprob: Some(-0.3),
                    no_speech_prob: Some(0.01),
                    compression_ratio: Some(1.4),
                })
                .collect(),
        }
    }

    #[test]
    fn asr_parts_are_offset_filtered_and_joined() {
        let first = whisper(&[(0.0, 4.0, " Selamat pagi semua. "), (4.0, 9.5, "Saya akan kirim laporan Jumat.")]);
        let mut second = whisper(&[(0.0, 3.0, "Saya akan kirim laporan Jumat."), (3.0, 6.0, "Oke.")]);
        second.segments.push(WhisperSegment {
            start: 6.0,
            end: 30.0,
            text: "Terima kasih telah menonton.".into(),
            avg_logprob: Some(-1.4),
            no_speech_prob: Some(0.9),
            compression_ratio: Some(1.1),
        });
        second.segments.push(WhisperSegment {
            start: 30.0,
            end: 40.0,
            text: "ya ya ya ya ya ya ya ya ya ya ya ya".into(),
            avg_logprob: Some(-0.2),
            no_speech_prob: Some(0.0),
            compression_ratio: Some(4.0),
        });

        let segments = segments_from_asr(&[(0.0, &first), (1200.0, &second)]);
        let lines: Vec<_> = segments.iter().map(format_segment).collect();
        assert_eq!(
            lines,
            ["[00:00] Selamat pagi semua.", "[00:04] Saya akan kirim laporan Jumat.", "[20:03] Oke."]
        );
        assert_eq!(segments[2].end_sec, Some(1206.0));
        assert_eq!(segments[2].index, 2);
    }

    #[test]
    fn speaker_timeline_names_segments_by_overlap() {
        let timeline = json!([
            { "participant": { "id": 1, "name": "Budi Santoso" }, "start_timestamp": { "relative": 0.0 }, "end_timestamp": { "relative": 5.0 } },
            { "participant": { "id": 2, "name": "Sari Dewi" }, "start_timestamp": { "relative": 5.0 }, "end_timestamp": null },
            { "participant": { "id": 1, "name": "Budi Santoso" }, "start_timestamp": { "relative": 20.0 }, "end_timestamp": { "relative": 25.0 } },
            { "participant": { "id": 3, "name": null }, "start_timestamp": { "relative": 26.0 }, "end_timestamp": { "relative": 27.0 } }
        ]);
        let spans = parse_speaker_timeline(&timeline);
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[1], SpeakerSpan { name: "Sari Dewi".into(), start: 5.0, end: 20.0 });

        let mut segments = segments_from_asr(&[(
            0.0,
            &whisper(&[(0.5, 4.0, "Pagi."), (4.5, 12.0, "Saya update docs."), (20.5, 24.0, "Saya kirim."), (40.0, 45.0, "Halo?")]),
        )]);
        assign_speakers(&mut segments, &spans);
        let speakers: Vec<_> = segments.iter().map(|s| s.speaker.as_deref()).collect();
        assert_eq!(speakers, [Some("Budi Santoso"), Some("Sari Dewi"), Some("Budi Santoso"), None]);
        assert_eq!(format_segment(&segments[1]), "[00:04] Sari Dewi: Saya update docs.");
    }

    #[test]
    fn sample_keeps_head_and_tail() {
        assert_eq!(head_tail_sample("abcdef", 2, 2), "ab\n[...]\nef");
        assert_eq!(head_tail_sample("abcd", 2, 2), "abcd");
    }
}
