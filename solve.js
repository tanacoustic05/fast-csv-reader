// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly the reference
// reading {columns, rows, errors} for {text, header}. Single left-to-right
// pass; fields located by one native regex scan each (not per-character), text
// materialized by slice (chunks joined only when a field needs rebuilding).
// Semantics mirrored from the reference vendor/csv-reader/index.js:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr), the chars
//     before it kept;
//   - quoted fields: "" is one quote, CRLF or lone CR inside is one LF; text
//     after the closing quote up to the next comma/line break is appended
//     (quote_junk when any of it is kept); an unclosed quote is a literal
//     character and the rest re-reads as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - rows are padded (short_row, fields) or cut (long_row, extra) to the
//     first record's width; errors carry the record's start line and row index.
// Pure: nothing kept from one call to the next.

const LF = 10;
const CR = 13;
const QUOTE = 34;
const COMMA_CH = 44;
const BOM = 0xfeff;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  // One native scan per use for the next field-significant character; the
  // regexes are per-call so no state ever crosses calls.
  const reU = /[,\r\n]/g; // ends an unquoted field (or is dropped: stray CR)
  const reQ = /["\r\n]/g; // significant inside a quoted field

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === BOM) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted run from pos up to the next comma or line break: a CR
  // followed by LF ends the field there; a lone CR is dropped (stray_cr), the
  // characters before it kept. `prefix` is carried into the value (the junk
  // phase after a closing quote). Returns { value, ended, added } with added
  // counting only the characters kept here.
  function readUnquoted(prefix) {
    // `chunks` ALWAYS holds the whole value including prefix: piece 0 is the
    // prefix itself when there is one. Value is chunks.join('').
    let chunks = null;
    let added = 0;
    for (;;) {
      reU.lastIndex = pos;
      const m = reU.exec(text);
      if (m === null) {
        // End of the text: whatever is left is kept.
        added += len - pos;
        const value =
          chunks === null
            ? (prefix === null ? '' : prefix) + text.slice(pos, len)
            : (chunks.push(text.slice(pos, len)), chunks.join(''));
        pos = len;
        return { value, ended: 2, added }; // 2 = END
      }
      const e = m.index;
      const ch = m[0];
      if (ch === '\r') {
        if (e + 1 < len && text.charCodeAt(e + 1) === LF) {
          // CRLF ends the field.
          added += e - pos;
          const value =
            chunks === null
              ? (prefix === null ? '' : prefix) + text.slice(pos, e)
              : (chunks.push(text.slice(pos, e)), chunks.join(''));
          pos = e + 2;
          line += 1;
          return { value, ended: 1, added }; // 1 = LINE_BREAK
        }
        // Lone CR: dropped (stray_cr), the characters before it kept.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        added += e - pos;
        chunks === null && (chunks = prefix === null ? [] : [prefix]);
        chunks.push(text.slice(pos, e));
        pos = e + 1;
        continue;
      }
      // Comma or LF ends the field.
      added += e - pos;
      const value =
        chunks === null
          ? (prefix === null ? '' : prefix) + text.slice(pos, e)
          : (chunks.push(text.slice(pos, e)), chunks.join(''));
      pos = e + 1;
      if (ch === '\n') {
        line += 1;
        return { value, ended: 1, added }; // 1 = LINE_BREAK
      }
      return { value, ended: 0, added }; // 0 = COMMA
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field and
  // how it ended, or null when the quote never closes (the caller re-reads).
  function readQuotedOnce() {
    const open = pos;
    const openLine = line;
    let chunks = null; // null while the whole content is one clean slice
    let p = pos + 1;
    for (;;) {
      reQ.lastIndex = p;
      const m = reQ.exec(text);
      if (m === null) {
        // The quote never closes.
        pos = open + 1;
        line = openLine;
        return null;
      }
      const e = m.index;
      const ch = m[0];
      if (ch === '"') {
        if (e + 1 < len && text.charCodeAt(e + 1) === QUOTE) {
          // "" is one quote inside the field.
          if (chunks === null) chunks = [text.slice(p, e), '"'];
          else {
            if (e > p) chunks.push(text.slice(p, e));
            chunks.push('"');
          }
          p = e + 2;
          continue;
        }
        // Closing quote: the content is complete.
        const content =
          chunks === null
            ? text.slice(p, e)
            : e > p
              ? chunks.join('') + text.slice(p, e)
              : chunks.join('');
        pos = e + 1;
        if (pos >= len) return { value: content, ended: 2 }; // END
        const c = text.charCodeAt(pos);
        if (c === COMMA_CH) {
          pos += 1;
          return { value: content, ended: 0 }; // COMMA
        }
        if (c === LF) {
          pos += 1;
          line += 1;
          return { value: content, ended: 1 }; // LINE_BREAK
        }
        if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
          pos += 2;
          line += 1;
          return { value: content, ended: 1 }; // LINE_BREAK
        }
        // What follows the closing quote is appended as it stands, up to the
        // next comma or line break (quote_junk when any of it is kept).
        const junk = readUnquoted(content);
        if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        return junk;
      }
      if (ch === '\r') {
        // CRLF and a lone CR inside quotes are each one LF.
        if (chunks === null) chunks = [text.slice(p, e), '\n'];
        else {
          if (e > p) chunks.push(text.slice(p, e));
          chunks.push('\n');
        }
        line += 1;
        p = e + (e + 1 < len && text.charCodeAt(e + 1) === LF ? 2 : 1);
        continue;
      }
      // A bare LF inside quotes: kept as-is, counts one line.
      if (chunks === null) chunks = [text.slice(p, e), '\n'];
      else {
        if (e > p) chunks.push(text.slice(p, e));
        chunks.push('\n');
      }
      line += 1;
      p = e + 1;
    }
  }

  // Reads one field at pos: quoted when it opens with a quote, else unquoted.
  // An unclosed quote is a literal character and the rest re-reads unquoted.
  function readField() {
    if (text.charCodeAt(pos) === QUOTE) {
      const f = readQuotedOnce();
      if (f !== null) return f;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    return readUnquoted(null);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === QUOTE;
      field = readField();
      fields.push(field.value);
    } while (field.ended === 0); // COMMA

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay). A quoted empty field is a record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? columns ?? [] : null, rows, errors };
}
