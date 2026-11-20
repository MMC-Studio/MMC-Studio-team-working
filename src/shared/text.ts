/** Bỏ dấu + chữ thường để so khớp không phân biệt dấu ("bao cao" khớp "Báo cáo", "dang" khớp "Đăng"). */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/** Mọi từ trong `query` (đã bỏ dấu) đều nằm trong `text`. Chuỗi tìm rỗng → luôn khớp. */
export function matchesAllWords(text: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean)
  const hay = foldText(text)
  return words.every((w) => hay.includes(w))
}
