import { jsPDF } from "jspdf";

interface RenderedCanvasResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export type DiagramExportOptions = {
  filename?: string;
  isDark?: boolean;
};

function parseExportParams(
  titleOrOptions: string | DiagramExportOptions = "diagram",
  defaultIsDark: boolean = false,
): { title: string; isDark: boolean } {
  if (typeof titleOrOptions === "string") {
    return { title: titleOrOptions, isDark: defaultIsDark };
  }
  return {
    title: titleOrOptions.filename || "diagram",
    isDark: titleOrOptions.isDark ?? defaultIsDark,
  };
}

function sanitizeFileName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_\-\s]/g, "").replace(/\s+/g, "_") || "diagram";
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Converts an SVG element to an offscreen HTML5 Canvas at 2x DPI.
 */
async function svgToCanvas(
  svgElement: SVGElement,
  backgroundColor?: string,
): Promise<RenderedCanvasResult> {
  const clone = svgElement.cloneNode(true) as SVGElement;

  // Resolve dimensions from viewBox or bounding client rect
  const viewBox = svgElement.getAttribute("viewBox");
  let width = 800;
  let height = 600;

  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = Math.ceil(parts[2]);
      height = Math.ceil(parts[3]);
    }
  } else {
    const bbox = svgElement.getBoundingClientRect();
    if (bbox.width > 0 && bbox.height > 0) {
      width = Math.ceil(bbox.width);
      height = Math.ceil(bbox.height);
    }
  }

  // Ensure clone has explicit pixel width, height, and namespaces
  clone.setAttribute("width", `${width}`);
  clone.setAttribute("height", `${height}`);
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.maxWidth = "none";

  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }

  // Inject font styles as an SVG-compliant <style> element with SVG namespace
  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = `
    * {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
  `;
  clone.insertBefore(styleEl, clone.firstChild);

  // Serialize SVG to XML string
  const svgData = new XMLSerializer().serializeToString(clone);

  // Encode as Data URL first; Data URLs don't have object revocation timing issues in browsers
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => {
      // Fallback: try Blob URL if Data URL length exceeded in older browsers
      const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        img.src = blobUrl;
        URL.revokeObjectURL(blobUrl);
        resolve();
      };
      fallbackImg.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error("Unable to rasterize SVG image for export"));
      };
      fallbackImg.src = blobUrl;
    };
    img.src = dataUrl;
  });

  const scale = 2; // 2x Retina resolution for sharp text and lines
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not initialize 2D canvas context");
  }

  ctx.scale(scale, scale);

  // Background fill if specified or required for JPG / PDF
  if (backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(img, 0, 0, width, height);

  return { canvas, width, height };
}

export async function exportDiagramAsPng(
  svgElement: SVGElement,
  titleOrOptions: string | DiagramExportOptions = "diagram",
  isDark: boolean = false,
): Promise<void> {
  const params = parseExportParams(titleOrOptions, isDark);
  const bg = params.isDark ? "#0A0D14" : "#FFFFFF";
  const { canvas } = await svgToCanvas(svgElement, bg);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Failed to generate PNG image"));
      const name = params.title.endsWith(".png")
        ? params.title
        : `${sanitizeFileName(params.title)}.png`;
      triggerDownload(blob, name);
      resolve();
    }, "image/png");
  });
}

export async function exportDiagramAsJpg(
  svgElement: SVGElement,
  titleOrOptions: string | DiagramExportOptions = "diagram",
  isDark: boolean = false,
): Promise<void> {
  const params = parseExportParams(titleOrOptions, isDark);
  const bg = params.isDark ? "#0A0D14" : "#FFFFFF";
  const { canvas } = await svgToCanvas(svgElement, bg);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Failed to generate JPG image"));
        const name = params.title.endsWith(".jpg")
          ? params.title
          : `${sanitizeFileName(params.title)}.jpg`;
        triggerDownload(blob, name);
        resolve();
      },
      "image/jpeg",
      0.95,
    );
  });
}

export async function exportDiagramAsPdf(
  svgElement: SVGElement,
  titleOrOptions: string | DiagramExportOptions = "diagram",
  isDark: boolean = false,
): Promise<void> {
  const params = parseExportParams(titleOrOptions, isDark);
  const bg = params.isDark ? "#0A0D14" : "#FFFFFF";
  const { canvas, width, height } = await svgToCanvas(svgElement, bg);

  const orientation = width >= height ? "landscape" : "portrait";
  const margin = 36; // 0.5 in / 36 pt
  const headerHeight = 44;

  const doc = new jsPDF({
    orientation,
    unit: "pt",
    format: [width + margin * 2, height + headerHeight + margin * 2],
  });

  // Background
  doc.setFillColor(params.isDark ? "#0A0D14" : "#FFFFFF");
  doc.rect(
    0,
    0,
    width + margin * 2,
    height + headerHeight + margin * 2,
    "F",
  );

  // Header Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(params.isDark ? "#F8FAFC" : "#0F172A");
  const cleanTitle = params.title.replace(/\.(pdf|png|jpg|jpeg)$/i, "");
  doc.text(cleanTitle, margin, margin + 14);

  // Timestamp subtitle
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(params.isDark ? "#94A3B8" : "#64748B");
  doc.text(`Generated with OpenTask on ${new Date().toLocaleDateString()}`, margin, margin + 28);

  // Render Image
  const imgData = canvas.toDataURL("image/png");
  doc.addImage(imgData, "PNG", margin, margin + headerHeight, width, height);

  const pdfName = params.title.endsWith(".pdf")
    ? params.title
    : `${sanitizeFileName(cleanTitle)}.pdf`;
  doc.save(pdfName);
}
