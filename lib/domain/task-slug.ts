export function normalizeTaskSlug(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function createTaskSlug() {
  return `task-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** An empty value asks the server to generate/preserve the identifier. */
export function taskSlugProblem(value: string): string | null {
  const slug = normalizeTaskSlug(value);
  if (!slug) return null;
  if (slug.length > 120) return "自訂代號最多 120 個字元。";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    return "代號請使用英文字母、數字與中間的連字號，例如 friedrice 或 fried-rice-01。中文請填在「任務名稱」；也可留空由系統產生。";
  if (slug.length < 3)
    return "自訂代號至少需要 3 個字元，例如 friedrice；也可以留空由系統產生。";
  return null;
}
