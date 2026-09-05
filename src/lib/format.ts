/** 字节数格式化：B / KB / MB / GB / TB，程序化计算，禁止手写估算 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  const text = exponent === 0 ? value.toFixed(0) : value.toFixed(decimals);
  return `${text} ${units[exponent]}`;
}

/** 文件数格式化（千分位） */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  return count.toLocaleString('zh-CN');
}
