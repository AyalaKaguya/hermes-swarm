export function parseAuthDevice(userAgent: string | null | undefined) {
  const value = userAgent ?? "";
  const browser = /Edg\//.test(value)
    ? "Edge"
    : /Chrome\//.test(value)
      ? "Chrome"
      : /Firefox\//.test(value)
        ? "Firefox"
        : /Safari\//.test(value)
          ? "Safari"
          : "未知浏览器";
  const os = /Windows NT/.test(value)
    ? "Windows"
    : /Mac OS X/.test(value)
      ? "macOS"
      : /Android/.test(value)
        ? "Android"
        : /iPhone|iPad|iPod/.test(value)
          ? "iOS"
          : /Linux/.test(value)
            ? "Linux"
            : "未知系统";
  return {
    browser,
    deviceLabel: `${browser} / ${os}`,
    os,
  };
}
