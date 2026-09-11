/**
 * fetch-stats.js
 *
 * Pulls problem-solved + contest-participation numbers from LeetCode,
 * Codeforces and CodeChef, sums them into one "overall" total, and
 * writes an SVG card to assets/combined-stats.svg for embedding in a
 * GitHub profile README.
 *
 * Requires Node 18+ (uses the built-in global `fetch`).
 * No npm dependencies.
 */

const fs = require("fs");
const path = require("path");

// ---- Config: usernames on each platform -----------------------------------
const LEETCODE_USERNAME = process.env.LEETCODE_USERNAME || "lukk_y";
const CODEFORCES_HANDLE = process.env.CODEFORCES_HANDLE || "lukkydiwan";
const CODECHEF_USERNAME = process.env.CODECHEF_USERNAME || "lukkydiwan1";

const OUTPUT_PATH = path.join(__dirname, "..", "assets", "combined-stats.svg");

// ---- LeetCode ---------------------------------------------------------------
async function getLeetCodeStats(username) {
  const query = `
    query userStats($username: String!) {
      matchedUser(username: $username) {
        submitStats {
          acSubmissionNum { difficulty count }
        }
      }
      userContestRanking(username: $username) {
        attendedContestsCount
      }
    }
  `;

  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { username } }),
  });

  if (!res.ok) throw new Error(`LeetCode request failed: ${res.status}`);
  const json = await res.json();

  const acStats = json?.data?.matchedUser?.submitStats?.acSubmissionNum || [];
  const total = acStats.find((s) => s.difficulty === "All")?.count || 0;
  const contests = json?.data?.userContestRanking?.attendedContestsCount || 0;

  return { solved: total, contests };
}

// ---- Codeforces ---------------------------------------------------------------
async function getCodeforcesStats(handle) {
  // Distinct solved problems: unique on (contestId, problem index/name)
  const statusRes = await fetch(
    `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}`
  );
  if (!statusRes.ok) throw new Error(`Codeforces user.status failed: ${statusRes.status}`);
  const statusJson = await statusRes.json();
  if (statusJson.status !== "OK") throw new Error(`Codeforces API error: ${statusJson.comment}`);

  const solvedSet = new Set();
  for (const sub of statusJson.result) {
    if (sub.verdict === "OK") {
      const key = `${sub.problem.contestId || "gym"}-${sub.problem.index}`;
      solvedSet.add(key);
    }
  }

  // Contests participated: one entry per rated contest in user.rating
  const ratingRes = await fetch(
    `https://codeforces.com/api/user.rating?handle=${encodeURIComponent(handle)}`
  );
  let contests = 0;
  if (ratingRes.ok) {
    const ratingJson = await ratingRes.json();
    if (ratingJson.status === "OK") contests = ratingJson.result.length;
  }

  return { solved: solvedSet.size, contests };
}

// ---- CodeChef (no official API — scrape the public profile page) --------------
async function getCodeChefStats(username) {
  const res = await fetch(`https://www.codechef.com/users/${encodeURIComponent(username)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (README stats bot)" },
  });
  if (!res.ok) throw new Error(`CodeChef profile request failed: ${res.status}`);
  const html = await res.text();

  // Skip over any HTML tags that may sit between the label and the number.
  const solvedMatch = html.match(/Total Problems Solved:\s*(?:<[^>]+>\s*)*(\d+)/i);
  const contestsMatch = html.match(
    /No\.\s*of\s*Contests?\s*Participated:?\s*(?:<[^>]+>\s*)*(\d+)/i
  );

  return {
    solved: solvedMatch ? parseInt(solvedMatch[1], 10) : 0,
    contests: contestsMatch ? parseInt(contestsMatch[1], 10) : 0,
  };
}

// ---- SVG card rendering ---------------------------------------------------
// One compact row: big "Overall" totals on the left, a divider, then a
// single "Platform: N solved" line per source on the right. No activity
// feeds, no difficulty bars — just the numbers.
function renderSvg({ totalSolved, totalContests, breakdown }) {
  const width = 720;
  const height = 120;
  const dividerX = 350;

  const rowGap = 24;
  const rowsStartY = 46;
  const rightRows = breakdown
    .map(
      (b, i) =>
        `<text x="${dividerX + 30}" y="${rowsStartY + i * rowGap}" class="plat-label">${b.label}</text>` +
        `<text x="${width - 30}" y="${rowsStartY + i * rowGap}" class="plat-value" text-anchor="end">${b.solved} solved</text>`
    )
    .join("\n  ");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .bg { fill: #0d1117; stroke: #30363d; stroke-width: 1; }
    .big-number { font: 700 34px 'Segoe UI', Ubuntu, Sans-Serif; fill: #f0f6fc; }
    .big-label { font: 400 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
    .plat-label { font: 600 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .plat-value { font: 400 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
    .divider { stroke: #30363d; stroke-width: 1; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" class="bg"/>

  <text x="35" y="48" class="big-number">${totalSolved}</text>
  <text x="35" y="68" class="big-label">Total Problems Solved</text>

  <text x="220" y="48" class="big-number">${totalContests}</text>
  <text x="220" y="68" class="big-label">Total Contests</text>

  <line x1="${dividerX}" y1="18" x2="${dividerX}" y2="${height - 18}" class="divider"/>
  ${rightRows}
</svg>`;
}

// ---- Main -------------------------------------------------------------------
async function main() {
  const results = await Promise.allSettled([
    getLeetCodeStats(LEETCODE_USERNAME),
    getCodeforcesStats(CODEFORCES_HANDLE),
    getCodeChefStats(CODECHEF_USERNAME),
  ]);

  const labels = ["LeetCode", "Codeforces", "CodeChef"];
  const breakdown = results.map((r, i) => {
    if (r.status === "fulfilled") {
      return { label: labels[i], solved: r.value.solved, contests: r.value.contests };
    }
    console.error(`Failed to fetch ${labels[i]} stats:`, r.reason?.message);
    return { label: `${labels[i]} (unavailable)`, solved: 0, contests: 0 };
  });

  const totalSolved = breakdown.reduce((sum, b) => sum + b.solved, 0);
  const totalContests = breakdown.reduce((sum, b) => sum + b.contests, 0);

  const svg = renderSvg({ totalSolved, totalContests, breakdown });

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, svg, "utf8");

  console.log("Combined stats:", { totalSolved, totalContests, breakdown });
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
