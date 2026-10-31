export function clip(s: string, max = 2000): string {
  return s.length <= max ? s : `${s.slice(0, max)}… [${s.length - max} more chars]`;
}

export function tail(s: string, max = 2000): string {
  return s.length <= max ? s : `…${s.slice(-max)}`;
}
