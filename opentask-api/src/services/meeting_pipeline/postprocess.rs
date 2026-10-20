use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::meeting::{Confidence, Segment};

/// A task as the model returned it. Checked everything here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExtractedTask {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type", default)]
    pub task_type: Option<String>,
    #[serde(default)]
    pub weight: Option<i64>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub assignee_hint: Option<String>,
    #[serde(default)]
    pub due_text: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub evidence_quote: String,
    #[serde(default)]
    pub confidence: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractionOutput {
    pub tasks: Vec<ExtractedTask>,
}

/// A project member the assignee matcher can pick.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MemberName {
    pub user_id: i64,
    pub display_name: Option<String>,
    pub gh_username: Option<String>,
}

/// A checked task, ready to become a draft.
#[derive(Debug, Clone, PartialEq)]
pub struct DraftCandidate {
    pub title: String,
    pub description: Option<String>,
    pub task_type: String,
    pub weight: Option<i32>,
    pub priority: Option<String>,
    pub assignee_hint: Option<String>,
    pub resolved_user_id: Option<i64>,
    pub due_text: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub evidence_quote: String,
    pub evidence_verified: bool,
    pub evidence_segment: Option<i32>,
    pub evidence_start_sec: Option<i32>,
    pub confidence: Confidence,
    pub original: Value,
}

pub struct PostProcessInput<'a> {
    pub tasks: Vec<ExtractedTask>,
    pub segments: &'a [Segment],
    pub meeting_date: NaiveDate,
    pub allowed_types: &'a [String],
    pub members: &'a [MemberName],
    pub max_tasks: usize,
}

pub fn post_process(input: PostProcessInput<'_>) -> Vec<DraftCandidate> {
    let normalized_segments: Vec<String> = input.segments.iter().map(|s| normalize(&s.text)).collect();

    let mut candidates: Vec<DraftCandidate> = input
        .tasks
        .into_iter()
        .filter(|t| !t.title.trim().is_empty())
        .map(|task| {
            let original = serde_json::to_value(&task).unwrap_or(Value::Null);
            let quote = clean_quote(&task.evidence_quote);
            let location = locate_evidence(&quote, &normalized_segments);
            let evidence_segment = location.map(|i| i as i32);
            let evidence_start_sec = location
                .and_then(|i| input.segments.get(i))
                .and_then(|s| s.start_sec)
                .map(|s| s as i32);
            let hint = task.assignee_hint.as_deref().map(str::trim).filter(|h| !h.is_empty());

            DraftCandidate {
                title: truncate(task.title.trim(), 120),
                description: task
                    .description
                    .as_deref()
                    .map(str::trim)
                    .filter(|d| !d.is_empty())
                    .map(|d| truncate(d, 500)),
                task_type: coerce_type(task.task_type.as_deref(), input.allowed_types),
                weight: task.weight.filter(|w| (1..=8).contains(w)).map(|w| w as i32),
                priority: task
                    .priority
                    .as_deref()
                    .map(|p| p.trim().to_ascii_lowercase())
                    .filter(|p| matches!(p.as_str(), "high" | "medium" | "low")),
                assignee_hint: hint.map(str::to_string),
                resolved_user_id: hint.and_then(|h| match_assignee(h, input.members)),
                due_text: task.due_text.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(str::to_string),
                due_date: sane_due_date(task.due_date.as_deref(), input.meeting_date),
                evidence_quote: truncate(&quote, 200),
                evidence_verified: location.is_some(),
                evidence_segment,
                evidence_start_sec,
                confidence: task
                    .confidence
                    .as_deref()
                    .and_then(|c| c.trim().to_ascii_lowercase().parse().ok())
                    .unwrap_or(Confidence::Low),
                original,
            }
        })
        .collect();

    candidates = dedupe(candidates);
    candidates.sort_by_key(|c| (!c.evidence_verified, c.evidence_segment.unwrap_or(i32::MAX)));
    candidates.truncate(input.max_tasks);
    candidates
}

/// Lowercase, ASCII-folded, punctuation as spaces, single spaces.
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars().flat_map(char::to_lowercase) {
        let c = fold_char(c);
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.ends_with(' ') {
            out.push(' ');
        }
    }
    out.trim().to_string()
}

fn fold_char(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
        'ñ' | 'ń' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' => 'u',
        'ý' | 'ÿ' => 'y',
        'š' | 'ś' => 's',
        'ž' | 'ź' | 'ż' => 'z',
        other => other,
    }
}

/// Strips a leading `[mm:ss]` and `Speaker:`
fn clean_quote(quote: &str) -> String {
    let mut q = quote.trim().trim_matches(['"', '“', '”', '\'']).trim();
    if q.starts_with('[')
        && let Some(end) = q.find(']')
    {
        q = q[end + 1..].trim_start();
    }
    if let Some((prefix, rest)) = q.split_once(':')
        && !prefix.is_empty()
        && prefix.len() <= 40
        && prefix.split_whitespace().count() <= 4
    {
        q = rest.trim_start();
    }
    q.to_string()
}

fn locate_evidence(quote: &str, segments: &[String]) -> Option<usize> {
    let needle = normalize(quote);
    if needle.len() < 8 {
        return None;
    }
    if let Some(i) = segments.iter().position(|s| s.contains(&needle)) {
        return Some(i);
    }
    for i in 0..segments.len().saturating_sub(1) {
        if format!("{} {}", segments[i], segments[i + 1]).contains(&needle) {
            return Some(i);
        }
    }

    let words: Vec<&str> = needle.split(' ').filter(|w| w.len() >= 3).collect();
    if words.len() < 4 {
        return None;
    }
    let mut best: Option<(usize, f32)> = None;
    for i in 0..segments.len() {
        let window = segments[i..(i + 3).min(segments.len())].join(" ");
        let window_words: std::collections::HashSet<&str> = window.split(' ').collect();
        let found = words.iter().filter(|w| window_words.contains(**w)).count();
        let ratio = found as f32 / words.len() as f32;
        if ratio >= 0.85 && best.is_none_or(|(_, r)| ratio > r) {
            best = Some((i, ratio));
        }
    }
    best.map(|(i, _)| i)
}

fn title_tokens(title: &str) -> std::collections::HashSet<String> {
    normalize(title).split(' ').filter(|w| w.len() > 1).map(str::to_string).collect()
}

fn jaccard(a: &std::collections::HashSet<String>, b: &std::collections::HashSet<String>) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f32;
    let union = a.union(b).count() as f32;
    inter / union
}

/// Merges tasks repeated across overlapping chunks: near-identical titles or the same evidence.
fn dedupe(candidates: Vec<DraftCandidate>) -> Vec<DraftCandidate> {
    let mut kept: Vec<(DraftCandidate, std::collections::HashSet<String>)> = Vec::new();
    for candidate in candidates {
        let tokens = title_tokens(&candidate.title);
        let quote = normalize(&candidate.evidence_quote);
        let duplicate = kept.iter_mut().find(|(k, k_tokens)| {
            jaccard(&tokens, k_tokens) >= 0.8
                || (!quote.is_empty() && quote.len() >= 12 && normalize(&k.evidence_quote) == quote)
        });
        match duplicate {
            Some((existing, _)) => merge_into(existing, candidate),
            None => kept.push((candidate, tokens)),
        }
    }
    kept.into_iter().map(|(c, _)| c).collect()
}

fn merge_into(existing: &mut DraftCandidate, other: DraftCandidate) {
    let other_earlier = match (existing.evidence_segment, other.evidence_segment) {
        (None, Some(_)) => true,
        (Some(a), Some(b)) => b < a,
        _ => false,
    };
    if other_earlier {
        existing.evidence_quote = other.evidence_quote.clone();
        existing.evidence_verified = other.evidence_verified;
        existing.evidence_segment = other.evidence_segment;
        existing.evidence_start_sec = other.evidence_start_sec;
    }
    existing.description = existing.description.take().or(other.description);
    existing.weight = existing.weight.or(other.weight);
    existing.priority = existing.priority.take().or(other.priority);
    existing.assignee_hint = existing.assignee_hint.take().or(other.assignee_hint);
    existing.resolved_user_id = existing.resolved_user_id.or(other.resolved_user_id);
    existing.due_text = existing.due_text.take().or(other.due_text);
    existing.due_date = existing.due_date.or(other.due_date);
}

/// Keeps a due date only if it parses and falls between the meeting and a year after it.
fn sane_due_date(value: Option<&str>, meeting_date: NaiveDate) -> Option<NaiveDate> {
    let date = NaiveDate::parse_from_str(value?.trim(), "%Y-%m-%d").ok()?;
    let days = (date - meeting_date).num_days();
    (0..=365).contains(&days).then_some(date)
}

fn coerce_type(value: Option<&str>, allowed: &[String]) -> String {
    let wanted = value.unwrap_or("").trim().to_ascii_uppercase();
    if allowed.contains(&wanted) {
        wanted
    } else {
        "OTHER".to_string()
    }
}

/// The member the hint names, if exactly one matches: full display name, first name, GitHub username, or one typo away from one of those (names of 5+ characters).
pub fn match_assignee(hint: &str, members: &[MemberName]) -> Option<i64> {
    let hint = normalize(hint);
    if hint.is_empty() {
        return None;
    }
    let hint_first = hint.split(' ').next().unwrap_or("").to_string();

    let mut matches: Vec<i64> = Vec::new();
    for member in members {
        let mut names: Vec<String> = Vec::new();
        if let Some(display) = member.display_name.as_deref().map(normalize).filter(|d| !d.is_empty()) {
            names.push(display.split(' ').next().unwrap_or("").to_string());
            names.push(display);
        }
        if let Some(login) = member.gh_username.as_deref().map(normalize).filter(|l| !l.is_empty()) {
            names.push(login.replace(' ', ""));
            names.push(login);
        }
        let is_match = names.iter().any(|name| {
            *name == hint
                || *name == hint_first && hint.split(' ').count() == 1
                || (name.len() >= 5 && hint.len() >= 5 && levenshtein(name, &hint) <= 1)
        });
        if is_match && !matches.contains(&member.user_id) {
            matches.push(member.user_id);
        }
    }
    (matches.len() == 1).then(|| matches[0])
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut current = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            current[j] = (prev[j] + 1).min(current[j - 1] + 1).min(prev[j - 1] + cost);
        }
        prev = current;
    }
    prev[b.len()]
}

fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        text.to_string()
    } else {
        text.chars().take(max_chars).collect::<String>().trim_end().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::meeting_pipeline::transcript::segments_from_text;

    fn task(title: &str, quote: &str) -> ExtractedTask {
        ExtractedTask {
            title: title.to_string(),
            description: None,
            task_type: Some("code".to_string()),
            weight: Some(3),
            priority: None,
            assignee_hint: None,
            due_text: None,
            due_date: None,
            evidence_quote: quote.to_string(),
            confidence: Some("high".to_string()),
        }
    }

    fn members() -> Vec<MemberName> {
        vec![
            MemberName { user_id: 1, display_name: Some("Budi Santoso".into()), gh_username: Some("budis".into()) },
            MemberName { user_id: 2, display_name: Some("José Ramírez".into()), gh_username: Some("jramirez".into()) },
            MemberName { user_id: 3, display_name: Some("Budi Hartono".into()), gh_username: Some("bhartono".into()) },
            MemberName { user_id: 4, display_name: Some("Sari Dewi".into()), gh_username: Some("saridewi".into()) },
        ]
    }

    fn run(tasks: Vec<ExtractedTask>, text: &str) -> Vec<DraftCandidate> {
        let segments = segments_from_text(text);
        let types = vec!["CODE".to_string(), "DESIGN".to_string(), "OTHER".to_string()];
        let members = members();
        post_process(PostProcessInput {
            tasks,
            segments: &segments,
            meeting_date: NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(),
            allowed_types: &types,
            members: &members,
            max_tasks: 30,
        })
    }

    #[test]
    fn evidence_is_found_despite_case_spacing_accents_and_prefixes() {
        let text = "Pembukaan rapat.\n\nBudi: Saya akan  menyiapkan laporan keuangan sebelum Jumat.\n\nJosé dará la demo.";
        let drafts = run(
            vec![
                task("Siapkan laporan keuangan", "[03:12] Budi: saya akan menyiapkan Laporan keuangan sebelum jumat"),
                task("Demo", "jose dara la demo"),
                task("Invented", "this sentence is nowhere in the record at all"),
            ],
            text,
        );
        assert_eq!(drafts.len(), 3);
        assert!(drafts[0].evidence_verified && drafts[0].evidence_segment == Some(1));
        assert!(drafts[1].evidence_verified && drafts[1].evidence_segment == Some(2));
        assert!(!drafts[2].evidence_verified, "unverified evidence sorts last");
    }

    #[test]
    fn evidence_spanning_two_segments_is_found() {
        let text = "Sari will update the onboarding\n\ndocs before the release next week.";
        let drafts = run(vec![task("Update docs", "update the onboarding docs before the release")], text);
        assert_eq!(drafts[0].evidence_segment, Some(0));
    }

    #[test]
    fn duplicates_from_overlapping_chunks_are_merged() {
        let text = "Intro.\n\nBudi will fix the login bug today.";
        let mut later = task("Fix the login bug", "Budi will fix the login bug today");
        later.due_text = Some("today".to_string());
        let drafts = run(vec![task("Fix login bug", "Budi will fix the login bug today"), later], text);
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].due_text.as_deref(), Some("today"));
    }

    #[test]
    fn due_dates_outside_the_window_are_dropped_but_text_is_kept() {
        let mut past = task("Past", "x");
        past.due_date = Some("2026-10-01".into());
        past.due_text = Some("last week".into());
        let mut ok = task("Soon", "y");
        ok.due_date = Some("2026-10-24".into());
        let mut far = task("Far", "z");
        far.due_date = Some("2028-01-01".into());
        let mut junk = task("Junk", "w");
        junk.due_date = Some("Friday".into());
        let drafts = run(vec![past, ok, far, junk], "nothing");
        let dates: Vec<_> = drafts.iter().map(|d| (d.title.as_str(), d.due_date)).collect();
        assert!(dates.contains(&("Past", None)));
        assert!(dates.contains(&("Soon", NaiveDate::from_ymd_opt(2026, 10, 24))));
        assert!(dates.contains(&("Far", None)));
        assert!(dates.contains(&("Junk", None)));
        assert_eq!(drafts.iter().find(|d| d.title == "Past").unwrap().due_text.as_deref(), Some("last week"));
    }

    #[test]
    fn assignees_match_only_when_unique() {
        let members = members();
        assert_eq!(match_assignee("Sari", &members), Some(4));
        assert_eq!(match_assignee("sari dewi", &members), Some(4));
        assert_eq!(match_assignee("@saridewi", &members), Some(4));
        assert_eq!(match_assignee("Jose", &members), Some(2));
        assert_eq!(match_assignee("José Ramirez", &members), Some(2));
        assert_eq!(match_assignee("Budi", &members), None, "two Budis");
        assert_eq!(match_assignee("Budi Santoso", &members), Some(1));
        assert_eq!(match_assignee("Budi Santosa", &members), Some(1), "one typo");
        assert_eq!(match_assignee("Andi", &members), None);
        assert_eq!(match_assignee("", &members), None);
    }

    #[test]
    fn type_weight_confidence_and_cap_are_coerced() {
        let mut odd = task("A", "a");
        odd.task_type = Some("marketing".into());
        odd.weight = Some(12);
        odd.confidence = Some("very".into());
        let mut fine = task("B", "b");
        fine.task_type = Some("Design".into());
        fine.weight = Some(8);
        fine.priority = Some("HIGH".into());
        let drafts = run(vec![odd, fine], "nothing");
        let a = drafts.iter().find(|d| d.title == "A").unwrap();
        assert_eq!((a.task_type.as_str(), a.weight, a.confidence), ("OTHER", None, Confidence::Low));
        let b = drafts.iter().find(|d| d.title == "B").unwrap();
        assert_eq!((b.task_type.as_str(), b.weight, b.priority.as_deref()), ("DESIGN", Some(8), Some("high")));

        let many: Vec<_> = (0..40).map(|i| task(&format!("Task number {i} alpha{i}"), "q")).collect();
        let segments = segments_from_text("nothing");
        let capped = post_process(PostProcessInput {
            tasks: many,
            segments: &segments,
            meeting_date: NaiveDate::from_ymd_opt(2026, 10, 19).unwrap(),
            allowed_types: &[],
            members: &[],
            max_tasks: 30,
        });
        assert_eq!(capped.len(), 30);
    }
}
