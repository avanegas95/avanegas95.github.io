import { describe, expect, it } from "vitest";
// Test-only import: links.ts must never import prompt.ts (the prompt text would enter the bundle).
import { ALLOWED_SITE_PATHS } from "../../src/lib/prompt";
import { LINK_HOSTS, SITE_PATHS, safeHref } from "../../src/scripts/blob/links";

describe("allowlists", () => {
  it("SITE_PATHS mirrors the prompt's ALLOWED_SITE_PATHS", () => {
    expect([...SITE_PATHS]).toEqual([...ALLOWED_SITE_PATHS]);
  });

  it("LINK_HOSTS is exactly the KB contact hosts", () => {
    expect([...LINK_HOSTS]).toEqual([
      "github.com",
      "linkedin.com",
      "www.linkedin.com",
    ]);
  });
});

describe("safeHref allows", () => {
  it.each([
    [
      "https://www.linkedin.com/in/avanegas95",
      "https://www.linkedin.com/in/avanegas95",
      true,
    ],
    ["https://github.com/avanegas95", "https://github.com/avanegas95", true],
    [
      "https://linkedin.com/in/avanegas95",
      "https://linkedin.com/in/avanegas95",
      true,
    ],
    ["https://github.com/avanegas95/", "https://github.com/avanegas95/", true],
    [
      "https://github.com/avanegas95/portfolio-v3",
      "https://github.com/avanegas95/portfolio-v3",
      true,
    ],
    [
      "https://github.com/avanegas95?tab=repositories",
      "https://github.com/avanegas95?tab=repositories",
      true,
    ],
    [
      "https://github.com/avanegas95#top",
      "https://github.com/avanegas95#top",
      true,
    ],
    [
      "https://www.linkedin.com/in/avanegas95/",
      "https://www.linkedin.com/in/avanegas95/",
      true,
    ],
    ["HTTPS://GITHUB.COM/avanegas95", "https://github.com/avanegas95", true],
    ["https://github.com/AvaNegas95", "https://github.com/AvaNegas95", true],
    ["mailto:AVANEGAS95@GMAIL.COM", "mailto:avanegas95@gmail.com", true],
    [
      "  https://github.com/avanegas95  ",
      "https://github.com/avanegas95",
      true,
    ],
    ["mailto:avanegas95@gmail.com", "mailto:avanegas95@gmail.com", true],
    ["MAILTO:avanegas95@gmail.com", "mailto:avanegas95@gmail.com", true],
    ["#contact", "#contact", false],
    ["/orbithop/", "/orbithop/", false],
    ["/", "/", false],
    ["/privacy/", "/privacy/", false],
  ])("%s", (raw, href, external) => {
    expect(safeHref(raw)).toEqual({ href, external });
  });

  it("allows every SITE_PATHS entry as same-site", () => {
    for (const p of SITE_PATHS) {
      expect(safeHref(p)).toEqual({ href: p, external: false });
    }
  });
});

describe("safeHref raw guard (passes new URL and the path prefix; only UNSAFE_RAW stops it)", () => {
  it.each([
    "https://github.com/avanegas95/%2fx",
    "https://github.com/avanegas95/%2Fx",
    "https://github.com/avanegas95/x..y",
    "https://github.com/avanegas95/..%2fevil",
    "https://github.com/avanegas95/%5c..%5cevil",
    "https://github.com/avanegas95/%40evil",
    "https://github.com/avanegas95?u=%2e%2e",
    "https://github.com/avanegas95/%252e%252e/x",
    "https://github.com/avanegas95/%25",
    "https://www.linkedin.com/in/avanegas95/%2fx",
  ])("%j", (raw) => {
    expect(safeHref(raw)).toBeNull();
  });
});

describe("safeHref rejects", () => {
  it.each([
    "",
    "   ",
    "http://github.com/avanegas95",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:x",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\u0000script:alert(1)",
    "javascript&#58;alert(1)",
    "&#106;avascript:alert(1)",
    "%6Aavascript:alert(1)",
    "javascript%3Aalert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "//github.com/avanegas95",
    "//evil.zz",
    "https://github.com.evil.zz",
    "https://github.com.evil.zz/avanegas95",
    "https://github.com@evil.zz",
    "https://user:pass@github.com/avanegas95",
    "https://user@github.com/",
    "https://github.com:443/avanegas95",
    "https://github.com:8443/avanegas95",
    "https://evil.zz/github.com",
    "https://evilgithub.com/",
    "https://github.com./avanegas95",
    "https://gist.github.com/x",
    "https://gіthub.com/avanegas95", // Cyrillic i look-alike
    "https://xn--gthub-n4a.com/avanegas95",
    "https://github。com/avanegas95", // ideographic full stop
    "https:\\\\github.com/avanegas95",
    "https:/github.com/avanegas95",
    "https://github.com\\@evil.zz",
    "https://github.com/a b",
    "https://github.com/​avanegas95",
    "HTTPS://EVIL.zz",
    "ftp://github.com/",
    "file:///etc/passwd",
    // Amendment: exactly the PLAN decision-log targets, nothing else on those hosts.
    "https://github.com",
    "https://github.com/",
    "https://github.com/evil/malware",
    "https://github.com/avanegas95evil",
    "https://github.com/avanegas95.evil",
    "https://github.com/xavanegas95",
    "https://github.com/in/avanegas95",
    "https://github.com/avanegas95/../../evil/repo",
    "https://github.com/avanegas95/%2e%2e/%2e%2e/evil/repo",
    "https://github.com/avanegas95/%2E%2E/evil",
    "https://github.com/avanegas95%2f..%2fevil",
    "https://github.com/avanegas95%2Fevil",
    "https://github.com/avanegas95%5cevil",
    "https://github.com/avanegas95%5Cevil",
    "https://github.com/avanegas95%40evil.zz",
    "https://github.com%40evil.zz/avanegas95",
    "https://github.com/avanegas95/./../evil",
    "https://linkedin.com/in/evil",
    "https://www.linkedin.com/in/evil",
    "https://www.linkedin.com/avanegas95",
    "https://www.linkedin.com/in/avanegas95evil",
    "https://www.linkedin.com/in/avanegas95/../evil",
    "https://www.linkedin.com/in/avanegas95/%2e%2e/evil",
    "https://www.linkedin.com/company/evil",
    "https://linkedin.com/",
    "https://github.com/AVANEGAS95/%2E%2E/x",
    "mailto:evil@evil.zz",
    "mailto:avanegas95@gmail.com.evil.zz",
    "mailto:avanegas95@evil.zz",
    "mailto:xavanegas95@gmail.com",
    "mailto:avanegas95%40gmail.com",
    "mailto:a@b?bcc=x",
    "mailto:avanegas95@gmail.com?subject=hi",
    "mailto:a@b.com,c@d.com",
    "mailto:a@b.com%0Abcc:c@d.com",
    "mailto:",
    "mailto:@gmail.com",
    "mailto:a@b",
    '#contact"onmouseover=',
    "#contact'onmouseover=alert(1)",
    "#evil",
    "#",
    "/orbithop/../x",
    "/orbithop",
    "/orbithop/x",
    "/privacy",
    "/Anderson_Vanegas_Resume.pdf",
    "orbithop/",
    "?x=1",
    "/\\evil.zz",
  ])("%j", (raw) => {
    expect(safeHref(raw)).toBeNull();
  });
});
