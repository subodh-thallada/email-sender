import { markdownToHtml, markdownToPlain, hasFormatting } from "../lib/send/render";

const md = `Hi Prof. Barfoot,

I read **Into Darkness** and had a question about the [lidar-intensity pipeline](https://example.edu/paper).

- I built a ROS2 stack
- Tested on \`rosbag\` replays

Best,
Subodh`;

let fail = 0;
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
  if (!ok) fail++;
};

const html = markdownToHtml(md);
check("bold rendered", html.includes("<strong>Into Darkness</strong>"));
check("link rendered", html.includes('href="https://example.edu/paper"'));
check("link opens safely", html.includes('rel="noopener noreferrer"'));
check("list rendered", html.includes("<li>"));
check("inline code", html.includes("<code>rosbag</code>"));
check("inline styles present (Gmail strips <style>)", html.includes("font-family:"));
check("no <style> block", !html.includes("<style"));

const xss = markdownToHtml(
  `[click](javascript:alert(1)) <script>alert(2)</script> <img src=x onerror=alert(3)>`,
);
check("javascript: scheme stripped", !xss.includes("javascript:"), );
check("script tag stripped", !xss.includes("<script"));
check("img/onerror stripped", !xss.includes("onerror"));

const plain = markdownToPlain(md);
check("plain keeps link text + url", plain.includes("lidar-intensity pipeline (https://example.edu/paper)"));
check("plain drops ** markers", !plain.includes("**"));
check("plain drops backticks", !plain.includes("`"));

check("hasFormatting true for markdown", hasFormatting(md));
check("hasFormatting false for plain note", !hasFormatting("Hi there,\n\nJust checking in.\n\nSubodh"));

console.log(fail ? `\n${fail} FAILED` : "\nAll render checks passed.");
process.exit(fail ? 1 : 0);
