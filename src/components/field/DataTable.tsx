"use client";

import { useI18n } from "@/components/I18nProvider";

/** Table view of a chart (dataviz accessibility rule: identity and values never colour-only). */
export function DataTable({ caption, headers, rows }: { caption: string; headers: readonly string[]; rows: ReadonlyArray<ReadonlyArray<string>> }) {
  const { t } = useI18n();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-water-700 underline-offset-2 hover:underline">{t("common.show_table")}</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full border-collapse text-left tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col" className="border-b border-sand-300 px-2 py-1 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="odd:bg-sand-100/60">
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className="px-2 py-1 font-normal">
                      {cell}
                    </th>
                  ) : (
                    <td key={j} className="px-2 py-1">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
