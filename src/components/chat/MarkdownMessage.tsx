"use client";

import type { ReactNode } from "react";

/**
 * Lightweight GFM-ish renderer (no extra deps).
 * Supports: headings, paragraphs, lists, bold/italic, inline/fenced code,
 * links (http/https only), blockquotes, simple tables, hr.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\n]+?\*|_[^_\n]+?_|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) != null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${i++}`;

    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-semibold text-[var(--text)]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-[var(--bg)]/70 px-1 py-0.5 font-mono text-[12px]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (match[2] != null && match[3] != null) {
      const href = match[3];
      const safe = /^https?:\/\//i.test(href) ? href : undefined;
      nodes.push(
        safe ? (
          <a
            key={key}
            href={safe}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] underline-offset-2 hover:underline"
          >
            {match[2]}
          </a>
        ) : (
          <span key={key}>{match[2]}</span>
        ),
      );
    }

    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderBlocks(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockId = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      blocks.push(
        <hr key={`hr-${blockId++}`} className="my-3 border-[var(--border)]" />,
      );
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]?.startsWith("```")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={`pre-${blockId++}`}
          className="mb-2 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg)]/50 p-3 text-[12px] last:mb-0"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const content = renderInline(heading[2] ?? "", `h-${blockId}`);
      const className =
        level === 1
          ? "mb-2 mt-3 text-base font-semibold first:mt-0"
          : level === 2
            ? "mb-2 mt-3 text-sm font-semibold first:mt-0"
            : "mb-1.5 mt-2 text-sm font-semibold first:mt-0";
      const Tag = (level === 1 ? "h1" : level === 2 ? "h2" : "h3") as
        | "h1"
        | "h2"
        | "h3";
      blocks.push(
        <Tag key={`h-${blockId++}`} className={className}>
          {content}
        </Tag>,
      );
      i += 1;
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? "")) {
      const header = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i] ?? ""));
        i += 1;
      }
      blocks.push(
        <div
          key={`table-${blockId++}`}
          className="mb-2 overflow-x-auto last:mb-0"
        >
          <table className="w-full min-w-[280px] border-collapse text-xs">
            <thead>
              <tr>
                {header.map((cell, idx) => (
                  <th
                    key={idx}
                    className="border border-[var(--border)] bg-[var(--bg)]/40 px-2 py-1 text-start font-medium"
                  >
                    {renderInline(cell, `th-${blockId}-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="border border-[var(--border)] px-2 py-1 align-top"
                    >
                      {renderInline(cell, `td-${blockId}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`bq-${blockId++}`}
          className="mb-2 border-s-2 border-[var(--accent)] ps-3 text-[var(--muted)] last:mb-0"
        >
          {renderInline(quote.join(" "), `bq-${blockId}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered
          ? /^\s*\d+\.\s+/.test(lines[i] ?? "")
          : /^\s*[-*]\s+/.test(lines[i] ?? ""))
      ) {
        items.push(
          (lines[i] ?? "").replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ""),
        );
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${blockId++}`}
          className={`mb-2 space-y-1 ps-5 last:mb-0 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderInline(item, `li-${blockId}-${idx}`)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i] ?? "") &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? "") &&
      !(lines[i] ?? "").startsWith("```") &&
      !/^\s*>\s?/.test(lines[i] ?? "")
    ) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push(
      <p key={`p-${blockId++}`} className="mb-2 last:mb-0 whitespace-pre-wrap">
        {renderInline(para.join("\n"), `p-${blockId}`)}
      </p>,
    );
  }

  return blocks;
}

export function MarkdownMessage({
  content,
  dir = "ltr",
  lang,
}: {
  content: string;
  dir?: "rtl" | "ltr";
  lang?: string;
}) {
  return (
    <div
      dir={dir}
      lang={lang}
      className="markdown-body break-content text-sm leading-relaxed text-start [unicode-bidi:plaintext]"
    >
      {renderBlocks(content)}
    </div>
  );
}
