// Generates the built-in starter templates (native doc JSON) into ./builtin/.
// Run: cd ui && npx tsx src/pinsela/templates/generateBuiltin.ts
// Content is original and generic: shapes, gradients and text only, Inter/Playfair (bundled, OFL).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyDoc, defaultNode } from "../core/scene";
import type { PinselaNode, PinselaTemplateDocV1 } from "../core/types";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "builtin");

type Rect = { x: number; y: number; w: number; h: number };
type Fill = string | Record<string, unknown>;

const grad = (angle: number, a: string, b: string) => ({
  type: "gradient",
  gradient_type: "linear",
  angle,
  stops: [{ offset: 0, color: a }, { offset: 1, color: b }],
});

class Page {
  doc: PinselaTemplateDocV1;
  private z = 0;
  private n = 0;
  constructor(readonly name: string, w: number, h: number, bg: string, private prefix: string) {
    this.doc = createEmptyDoc(w, h);
    this.doc.canvas.background = bg;
    this.doc.nodes = this.doc.nodes.map((node) => (node.id === "root"
      ? { ...node, style: { ...node.style, fill: bg } }
      : node));
    this.doc.metadata = { source: "pinsela-builtin", components: { definitions: [] } };
  }
  private id(kind: string) {
    this.n += 1;
    return `${this.prefix}_${kind}_${this.n}`;
  }
  private push(node: PinselaNode) {
    this.z += 1;
    node.geometry.z_index = this.z;
    this.doc.nodes.push(node);
  }
  rect(r: Rect, fill: Fill, opts: { radius?: number; opacity?: number; name?: string; stroke?: { color: string; width: number } } = {}) {
    const base = defaultNode("rect", {
      id: this.id("rect"),
      name: opts.name || "Shape",
      geometry: { ...defaultNode("rect").geometry, x: r.x, y: r.y, width: r.w, height: r.h, corner_radius: opts.radius || 0 },
    });
    base.style = {
      ...base.style,
      fill: fill as any,
      opacity: opts.opacity ?? 1,
      ...(opts.stroke ? { stroke: { color: opts.stroke.color, width: opts.stroke.width, dash: [], cap: "butt" } as any } : {}),
    };
    this.push(base);
  }
  circle(cx: number, cy: number, d: number, fill: Fill, opts: { opacity?: number } = {}) {
    this.rect({ x: cx - d / 2, y: cy - d / 2, w: d, h: d }, fill, { radius: d / 2, opacity: opts.opacity, name: "Circle" });
  }
  text(
    value: string,
    r: Rect,
    o: { size: number; color: string; weight?: "Regular" | "Medium" | "SemiBold" | "Bold"; family?: string; align?: "left" | "center" | "right"; lh?: number; ls?: number; name?: string },
  ) {
    const family = o.family || "Inter";
    const weight = o.weight || "Regular";
    const node = defaultNode("text", {
      id: this.id("text"),
      name: o.name || value.slice(0, 24),
      text: value,
      geometry: { ...defaultNode("text").geometry, x: r.x, y: r.y, width: r.w, height: r.h },
    });
    node.text_style = {
      family,
      style: weight,
      postscript: `${family.replace(/\s+/g, "")}-${weight}`,
      size: o.size,
      line_height: o.lh ?? 120,
      line_height_unit: "percent",
      letter_spacing: o.ls ?? 0,
      text_align: o.align || "left",
      vertical_align: "top",
      color: o.color,
    } as any;
    this.push(node);
  }
}

type Template = { id: string; name: string; description: string; pages: Page[] };

const templates: Template[] = [];

// 1. Announcement post (1080x1080)
{
  const p = new Page("Announcement", 1080, 1080, "#0F172A", "announcement");
  p.rect({ x: 0, y: 0, w: 1080, h: 1080 }, grad(135, "#1E1B4B", "#0F766E"), { name: "Background" });
  p.circle(900, 180, 420, "#2DD4BF", { opacity: 0.18 });
  p.circle(120, 980, 360, "#A78BFA", { opacity: 0.2 });
  p.rect({ x: 90, y: 120, w: 220, h: 56 }, "#2DD4BF", { radius: 28, name: "Badge" });
  p.text("NEW", { x: 90, y: 134, w: 220, h: 30 }, { size: 22, color: "#0F172A", weight: "Bold", align: "center", ls: 3, name: "Badge text" });
  p.text("Your big news starts here", { x: 90, y: 300, w: 900, h: 380 }, { size: 104, color: "#FFFFFF", weight: "Bold", lh: 105, name: "Title" });
  p.text("Describe the main benefit of your offer in one sentence.", { x: 90, y: 720, w: 760, h: 110 }, { size: 36, color: "#CBD5E1", lh: 140, name: "Subtitle" });
  p.rect({ x: 90, y: 880, w: 380, h: 88 }, "#FFFFFF", { radius: 44, name: "Button" });
  p.text("Learn more", { x: 90, y: 905, w: 380, h: 44 }, { size: 32, color: "#0F172A", weight: "SemiBold", align: "center", name: "Button text" });
  templates.push({ id: "post-announcement", name: "Announcement post", description: "Square post with a bold title and button", pages: [p] });
}

// 2. Event story (1080x1920)
{
  const p = new Page("Story", 1080, 1920, "#FFF7ED", "story");
  p.rect({ x: 0, y: 0, w: 1080, h: 1920 }, grad(160, "#FB923C", "#E11D48"), { name: "Background" });
  p.circle(540, 560, 760, "#FFFFFF", { opacity: 0.12 });
  p.circle(540, 560, 520, "#FFFFFF", { opacity: 0.14 });
  p.text("LIVE", { x: 90, y: 150, w: 900, h: 50 }, { size: 36, color: "#FFFFFF", weight: "Bold", align: "center", ls: 8, name: "Label" });
  p.text("Creators", { x: 90, y: 440, w: 900, h: 240 }, { size: 200, color: "#FFFFFF", weight: "Bold", family: "Playfair Display", align: "center", lh: 100, name: "Title" });
  p.text("meetup", { x: 90, y: 680, w: 900, h: 140 }, { size: 110, color: "#FFFFFF", weight: "Regular", family: "Playfair Display", align: "center", lh: 100, name: "Title 2" });
  p.rect({ x: 90, y: 1180, w: 900, h: 300 }, "#FFFFFF", { radius: 40, opacity: 0.95, name: "Card" });
  p.text("Saturday, September 20", { x: 130, y: 1230, w: 820, h: 70 }, { size: 52, color: "#9F1239", weight: "Bold", align: "center", name: "Date" });
  p.text("7 PM · Cultural Center", { x: 130, y: 1320, w: 820, h: 60 }, { size: 40, color: "#475569", align: "center", name: "Location" });
  p.text("Swipe up to confirm your attendance", { x: 90, y: 1700, w: 900, h: 60 }, { size: 34, color: "#FFFFFF", weight: "Medium", align: "center", name: "Call to action" });
  templates.push({ id: "story-event", name: "Event story", description: "Vertical story to promote a date and location", pages: [p] });
}

// 3. Carousel (3 pages 1080x1350)
{
  const mk = (i: number) => new Page(`Slide ${i}`, 1080, 1350, "#F8FAFC", `carousel${i}`);
  const a = mk(1);
  a.rect({ x: 0, y: 0, w: 1080, h: 1350 }, grad(180, "#312E81", "#4F46E5"), { name: "Background" });
  a.circle(940, 1180, 520, "#FFFFFF", { opacity: 0.1 });
  a.text("3 TIPS", { x: 90, y: 170, w: 600, h: 50 }, { size: 36, color: "#C7D2FE", weight: "Bold", ls: 6, name: "Label" });
  a.text("How to organize your ideas in minutes", { x: 90, y: 340, w: 900, h: 480 }, { size: 112, color: "#FFFFFF", weight: "Bold", lh: 108, name: "Title" });
  a.text("Swipe to see  →", { x: 90, y: 1180, w: 600, h: 50 }, { size: 36, color: "#E0E7FF", weight: "Medium", name: "Call to action" });
  const b = mk(2);
  b.rect({ x: 0, y: 0, w: 1080, h: 1350 }, "#F8FAFC", { name: "Background" });
  b.rect({ x: 90, y: 150, w: 140, h: 140 }, "#4F46E5", { radius: 70, name: "Number background" });
  b.text("1", { x: 90, y: 178, w: 140, h: 100 }, { size: 96, color: "#FFFFFF", weight: "Bold", align: "center", lh: 100, name: "Number" });
  b.text("Start with the essentials", { x: 90, y: 380, w: 900, h: 260 }, { size: 92, color: "#0F172A", weight: "Bold", lh: 108, name: "Title" });
  b.text("Explain the first tip in two or three short lines, in simple, direct language.", { x: 90, y: 700, w: 880, h: 300 }, { size: 44, color: "#475569", lh: 150, name: "Text" });
  const c = mk(3);
  c.rect({ x: 0, y: 0, w: 1080, h: 1350 }, grad(180, "#4F46E5", "#312E81"), { name: "Background" });
  c.text("Liked it?", { x: 90, y: 360, w: 900, h: 200 }, { size: 160, color: "#FFFFFF", weight: "Bold", align: "center", lh: 100, name: "Title" });
  c.text("Save this post and share it with someone who needs it.", { x: 140, y: 620, w: 800, h: 220 }, { size: 52, color: "#E0E7FF", align: "center", lh: 140, name: "Text" });
  c.rect({ x: 290, y: 940, w: 500, h: 100 }, "#FFFFFF", { radius: 50, name: "Button" });
  c.text("@yourprofile", { x: 290, y: 966, w: 500, h: 50 }, { size: 40, color: "#312E81", weight: "Bold", align: "center", name: "Profile" });
  templates.push({ id: "carousel-tips", name: "Tips carousel", description: "3 pages: cover, tip and closing", pages: [a, b, c] });
}

// 4. Quote (1080x1080)
{
  const p = new Page("Quote", 1080, 1080, "#FEF3C7", "quote");
  p.rect({ x: 0, y: 0, w: 1080, h: 1080 }, "#FEF3C7", { name: "Background" });
  p.rect({ x: 60, y: 60, w: 960, h: 960 }, "rgba(0,0,0,0)", { stroke: { color: "#92400E", width: 3 }, name: "Frame" });
  p.text("“", { x: 110, y: 90, w: 300, h: 300 }, { size: 340, color: "#D97706", weight: "Bold", family: "Playfair Display", lh: 100, name: "Quote mark" });
  p.text("Simplicity is the ultimate sophistication.", { x: 140, y: 340, w: 800, h: 380 }, { size: 80, color: "#451A03", family: "Playfair Display", weight: "Regular", lh: 125, name: "Quote" });
  p.rect({ x: 140, y: 800, w: 120, h: 6 }, "#D97706", { name: "Line" });
  p.text("Author name", { x: 140, y: 840, w: 700, h: 60 }, { size: 40, color: "#92400E", weight: "SemiBold", name: "Author" });
  templates.push({ id: "quote", name: "Quote", description: "Highlighted quote with a frame", pages: [p] });
}

// 5. Invitation (1080x1350)
{
  const p = new Page("Invitation", 1080, 1350, "#FDF2F8", "invitation");
  p.rect({ x: 0, y: 0, w: 1080, h: 1350 }, grad(180, "#FDF2F8", "#FCE7F3"), { name: "Background" });
  p.rect({ x: 70, y: 70, w: 940, h: 1210 }, "rgba(0,0,0,0)", { stroke: { color: "#BE185D", width: 4 }, radius: 24, name: "Frame" });
  p.text("YOU'RE INVITED", { x: 120, y: 190, w: 840, h: 50 }, { size: 34, color: "#BE185D", weight: "Medium", align: "center", ls: 8, name: "Label" });
  p.text("Birthday party", { x: 120, y: 330, w: 840, h: 340 }, { size: 120, color: "#831843", family: "Playfair Display", weight: "Bold", align: "center", lh: 108, name: "Title" });
  p.rect({ x: 470, y: 720, w: 140, h: 5 }, "#BE185D", { name: "Line" });
  p.text("Saturday, November 14", { x: 120, y: 790, w: 840, h: 70 }, { size: 52, color: "#831843", weight: "SemiBold", align: "center", name: "Date" });
  p.text("starting at 6 PM", { x: 120, y: 870, w: 840, h: 60 }, { size: 44, color: "#9D174D", align: "center", name: "Time" });
  p.text("123 Flower Street · Downtown", { x: 120, y: 960, w: 840, h: 60 }, { size: 40, color: "#9D174D", align: "center", name: "Location" });
  p.text("RSVP by the 10th", { x: 120, y: 1120, w: 840, h: 50 }, { size: 34, color: "#BE185D", weight: "Medium", align: "center", name: "RSVP" });
  templates.push({ id: "invitation", name: "Invitation", description: "Elegant invitation with date and location", pages: [p] });
}

// 6. Banner (1920x1080)
{
  const p = new Page("Banner", 1920, 1080, "#022C22", "banner");
  p.rect({ x: 0, y: 0, w: 1920, h: 1080 }, grad(100, "#022C22", "#047857"), { name: "Background" });
  p.circle(1500, 540, 900, "#34D399", { opacity: 0.18 });
  p.circle(1500, 540, 560, "#34D399", { opacity: 0.22 });
  p.text("SEASONAL SALE", { x: 140, y: 230, w: 1000, h: 50 }, { size: 36, color: "#6EE7B7", weight: "Bold", ls: 6, name: "Label" });
  p.text("Up to 40% off", { x: 140, y: 320, w: 1100, h: 280 }, { size: 150, color: "#FFFFFF", weight: "Bold", lh: 105, name: "Title" });
  p.text("Enjoy these offers for a limited time.", { x: 140, y: 650, w: 1000, h: 70 }, { size: 48, color: "#D1FAE5", name: "Subtitle" });
  p.rect({ x: 140, y: 790, w: 420, h: 100 }, "#FFFFFF", { radius: 50, name: "Button" });
  p.text("View offers", { x: 140, y: 816, w: 420, h: 50 }, { size: 40, color: "#064E3B", weight: "Bold", align: "center", name: "Button text" });
  templates.push({ id: "banner-promo", name: "Promo banner", description: "Horizontal banner 1920 × 1080", pages: [p] });
}

for (const t of templates) {
  const pages = t.pages.map((pg, i) => ({ id: `${t.id}-p${i + 1}`, name: pg.name, doc: pg.doc }));
  const first = pages[0].doc;
  const doc: PinselaTemplateDocV1 = {
    ...first,
    metadata: {
      ...(first.metadata || {}),
      project_pages_v1: { version: 1, active_page_id: pages[0].id, pages },
    },
  };
  const out = { id: t.id, name: t.name, description: t.description, doc_json: doc };
  writeFileSync(join(OUT, `${t.id}.json`), `${JSON.stringify(out, null, 2)}\n`);
}
console.log(`built-in templates: ${templates.length}`);
