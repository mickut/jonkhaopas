import { createReadStream } from "node:fs";
import { parse } from "csv-parse";

/** Streams a GTFS CSV file row-by-row as header-keyed objects; never loads the whole file into memory. */
export function readCsvRows(
  filePath: string,
): AsyncIterable<Record<string, string>> {
  return createReadStream(filePath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  );
}
