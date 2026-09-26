/**
 * Das Schema als Bild (2.41): eine reine Funktion, die aus Tabellen, Spalten
 * und Fremdschluesseln die Geometrie eines Diagramms rechnet.
 *
 * Kein React, keine Farbe, keine Sprache. Die Ansicht setzt daraus das SVG
 * zusammen und faerbt es mit `currentColor` und den CSS-Variablen der Console;
 * die Beschriftungen laufen dort durch den Uebersetzungskatalog. Dieses Modul
 * kennt nur Zahlen und Namen. Gleiche Eingabe heisst gleiche Ausgabe: kein
 * Zufall, keine Uhrzeit, keine Kraftsimulation. Genau deshalb braucht der
 * Visualizer keine neue Abhaengigkeit.
 *
 * Das Verfahren in drei Schritten:
 *
 * 1. Tabellen nach Namen sortieren. Zeigt ein Fremdschluessel auf eine Tabelle,
 *    die nicht im Schema liegt, kommt sie als eigener Kasten dazu, mit
 *    `external` markiert und mit dem fremden Schema im Titel. Wegwerfen waere
 *    eine Luege im Bild.
 * 2. Die Kaesten in ein Gitter legen. Die Spaltenzahl folgt der Tabellenzahl
 *    (1, 2, 3 oder 4); jede Gitterzeile ist so hoch wie ihr hoechster Kasten,
 *    darum kann sich kein Kasten mit einem anderen ueberschneiden.
 * 3. Je Fremdschluessel eine Linie von der verweisenden Spalte zur Zieltabelle,
 *    rechtwinklig mit einem Knick in der Mitte. Ein Schluessel auf die eigene
 *    Tabelle wird zur Schlaufe an der rechten Kante.
 */

export type DiagramColumn = {
  name: string;
  dataType: string;
  notNull: boolean;
  /** Nur gesetzt, wenn die Quelle es wirklich hergibt; die Schema-Route tut das nicht. */
  primaryKey?: boolean;
};

export type DiagramTable = {
  name: string;
  columns: DiagramColumn[];
};

export type DiagramRelation = {
  name: string;
  table: string;
  columns: string[];
  /** Das Schema der Zieltabelle, wie der Katalog es nennt. */
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
  /** `no_action`, `restrict`, `cascade`, `set_null` oder `set_default`. */
  onDelete: string;
};

export type DiagramRow = {
  column: string;
  dataType: string;
  notNull: boolean;
  primaryKey: boolean;
  /** Die Spalte gehoert zu einem Fremdschluessel dieser Tabelle. */
  foreignKey: boolean;
  y: number;
};

export type DiagramBox = {
  /** `tabelle` im eigenen Schema, `schema.tabelle` bei einer fremden. */
  id: string;
  title: string;
  /** Der Kasten steht fuer eine Tabelle aus einem anderen Schema. */
  external: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Grundlinie der Kopfzeile. */
  titleY: number;
  /** Trennlinie unter dem Kopf. */
  dividerY: number;
  rows: DiagramRow[];
  /** Spalten, die nicht mehr in den Kasten passen; 0 heisst alle sind da. */
  hiddenColumns: number;
  hiddenY: number;
};

export type DiagramEdge = {
  id: string;
  name: string;
  from: string;
  to: string;
  /** Der rechtwinklige Pfad als `d`-Attribut. */
  path: string;
  /** Die Pfeilspitze am Ziel, ebenfalls als `d`-Attribut. */
  arrow: string;
  labelX: number;
  labelY: number;
  labelAnchor: "middle" | "start";
  columns: string[];
  referencedColumns: string[];
  onDelete: string;
  selfReference: boolean;
  /** Das Ziel liegt in einem anderen Schema. */
  external: boolean;
};

export type SchemaDiagram = {
  width: number;
  height: number;
  columnsPerRow: number;
  boxes: DiagramBox[];
  edges: DiagramEdge[];
};

const MARGIN = 16;
const BOX_WIDTH = 236;
const GAP_X = 104;
const GAP_Y = 56;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 17;
const BOX_PADDING_BOTTOM = 10;
/** Mehr Zeilen macht den Kasten hoeher als lesbar; der Rest steht als Zahl darunter. */
const MAX_ROWS = 12;
/** Platz rechts fuer die Schlaufen der Selbstverweise. */
const LOOP_LANE = 44;
const LOOP_OUT = 26;
const LOOP_DROP = 22;
const ARROW = 7;

/** Wie viele Kaesten nebeneinander: 1 bei einer Tabelle, sonst gestaffelt bis 4. */
export function columnsPerRow(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

function boxHeight(rows: number, hidden: number): number {
  return HEADER_HEIGHT + (rows + (hidden > 0 ? 1 : 0)) * ROW_HEIGHT + BOX_PADDING_BOTTOM;
}

function round(value: number): number {
  // Halbe Pixel sind in einem SVG kein Fehler, machen aber jeden Vergleich in
  // einem Test unlesbar. Gerundet wird einmal, hier.
  return Math.round(value * 100) / 100;
}

function arrowPath(x: number, y: number, direction: "left" | "right" | "up" | "down"): string {
  switch (direction) {
    case "right": return `M ${round(x - ARROW)} ${round(y - 4)} L ${round(x)} ${round(y)} L ${round(x - ARROW)} ${round(y + 4)}`;
    case "left": return `M ${round(x + ARROW)} ${round(y - 4)} L ${round(x)} ${round(y)} L ${round(x + ARROW)} ${round(y + 4)}`;
    case "down": return `M ${round(x - 4)} ${round(y - ARROW)} L ${round(x)} ${round(y)} L ${round(x + 4)} ${round(y - ARROW)}`;
    default: return `M ${round(x - 4)} ${round(y + ARROW)} L ${round(x)} ${round(y)} L ${round(x + 4)} ${round(y + ARROW)}`;
  }
}

/**
 * Die Kennung eines Kastens: eine Tabelle des abgefragten Schemas heisst wie
 * sie, eine fremde traegt ihr Schema davor. Beides ist gleichzeitig der Titel,
 * und damit steht das fremde Schema im Bild.
 */
function boxId(schema: string, referencedSchema: string, table: string): string {
  return referencedSchema === schema ? table : `${referencedSchema}.${table}`;
}

export function buildSchemaDiagram(input: {
  schema: string;
  tables: DiagramTable[];
  relations: DiagramRelation[];
}): SchemaDiagram {
  const schema = input.schema;
  const tables = [...input.tables].sort((left, right) => left.name.localeCompare(right.name, "en"));
  const relations = [...input.relations].sort((left, right) =>
    left.table.localeCompare(right.table, "en") || left.name.localeCompare(right.name, "en"));

  const known = new Set(tables.map((table) => table.name));
  // Ziele, die im Schema nicht liegen: ein fremdes Schema, oder eine Tabelle,
  // die der Katalog nicht als Tabelle fuehrt. Beide bekommen einen eigenen Kasten.
  const externals = new Map<string, DiagramRelation>();
  for (const relation of relations) {
    const id = boxId(schema, relation.referencedSchema, relation.referencedTable);
    if (relation.referencedSchema === schema && known.has(relation.referencedTable)) continue;
    if (!externals.has(id)) externals.set(id, relation);
  }

  type Planned = { id: string; title: string; external: boolean; rows: DiagramRow[]; hiddenColumns: number };
  const planned: Planned[] = tables.map((table) => {
    const keyColumns = new Set(relations.filter((relation) => relation.table === table.name).flatMap((relation) => relation.columns));
    const shown = table.columns.slice(0, MAX_ROWS);
    return {
      id: table.name,
      title: table.name,
      external: false,
      hiddenColumns: table.columns.length - shown.length,
      rows: shown.map((column, index) => ({
        column: column.name,
        dataType: column.dataType,
        notNull: column.notNull,
        primaryKey: column.primaryKey === true,
        foreignKey: keyColumns.has(column.name),
        // y ist die Grundlinie der Zeile, relativ zum Kasten; verschoben wird spaeter.
        y: HEADER_HEIGHT + (index + 1) * ROW_HEIGHT - 5,
      })),
    };
  });
  for (const [id, relation] of [...externals.entries()].sort((left, right) => left[0].localeCompare(right[0], "en"))) {
    planned.push({
      id,
      title: id,
      external: true,
      hiddenColumns: 0,
      rows: relation.referencedColumns.map((column, index) => ({
        column, dataType: "", notNull: false, primaryKey: false, foreignKey: false,
        y: HEADER_HEIGHT + (index + 1) * ROW_HEIGHT - 5,
      })),
    });
  }

  const perRow = columnsPerRow(planned.length);
  const rowHeights: number[] = [];
  for (const [index, entry] of planned.entries()) {
    const row = Math.floor(index / perRow);
    const height = boxHeight(entry.rows.length, entry.hiddenColumns);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, height);
  }
  const rowTops: number[] = [];
  let top = MARGIN;
  for (const [row, height] of rowHeights.entries()) {
    rowTops[row] = top;
    top += height + GAP_Y;
  }

  const boxes: DiagramBox[] = planned.map((entry, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const x = MARGIN + column * (BOX_WIDTH + GAP_X);
    const y = rowTops[row];
    const height = boxHeight(entry.rows.length, entry.hiddenColumns);
    return {
      id: entry.id,
      title: entry.title,
      external: entry.external,
      x, y, width: BOX_WIDTH, height,
      titleY: y + 20,
      dividerY: y + HEADER_HEIGHT,
      rows: entry.rows.map((cell) => ({ ...cell, y: y + cell.y })),
      hiddenColumns: entry.hiddenColumns,
      hiddenY: y + HEADER_HEIGHT + (entry.rows.length + 1) * ROW_HEIGHT - 5,
    };
  });
  const byId = new Map(boxes.map((box) => [box.id, box]));

  const edges: DiagramEdge[] = [];
  for (const relation of relations) {
    const source = byId.get(relation.table);
    const targetId = boxId(schema, relation.referencedSchema, relation.referencedTable);
    const target = byId.get(targetId);
    if (!source || !target) continue;
    const anchor = (box: DiagramBox, column: string | undefined) => {
      const row = box.rows.find((entry) => entry.column === column);
      return row ? row.y - 4 : box.y + HEADER_HEIGHT / 2;
    };
    const fromY = anchor(source, relation.columns[0]);
    const toY = anchor(target, relation.referencedColumns[0]);
    const external = relation.referencedSchema !== schema;
    const base = {
      id: `${relation.table}.${relation.name}`,
      name: relation.name,
      from: source.id,
      to: target.id,
      columns: relation.columns,
      referencedColumns: relation.referencedColumns,
      onDelete: relation.onDelete,
      external,
    };
    if (source.id === target.id) {
      // Schlaufe an der rechten Kante: raus, runter, zurueck auf denselben Kasten.
      const right = source.x + source.width;
      const outX = right + LOOP_OUT;
      const backY = fromY + LOOP_DROP;
      edges.push({
        ...base,
        selfReference: true,
        path: `M ${round(right)} ${round(fromY)} H ${round(outX)} V ${round(backY)} H ${round(right)}`,
        arrow: arrowPath(right, backY, "left"),
        labelX: round(outX + 6),
        labelY: round(fromY + LOOP_DROP / 2),
        labelAnchor: "start",
      });
      continue;
    }
    const sourceCenter = source.x + source.width / 2;
    const targetCenter = target.x + target.width / 2;
    const toRight = targetCenter >= sourceCenter;
    const fromX = toRight ? source.x + source.width : source.x;
    const toX = toRight ? target.x : target.x + target.width;
    const middle = (fromX + toX) / 2;
    edges.push({
      ...base,
      selfReference: false,
      path: `M ${round(fromX)} ${round(fromY)} H ${round(middle)} V ${round(toY)} H ${round(toX)}`,
      arrow: arrowPath(toX, toY, toRight ? "right" : "left"),
      labelX: round(middle),
      labelY: round((fromY + toY) / 2 - 5),
      labelAnchor: "middle",
    });
  }

  const lastRow = rowHeights.length - 1;
  return {
    width: MARGIN * 2 + perRow * BOX_WIDTH + Math.max(0, perRow - 1) * GAP_X + LOOP_LANE,
    height: planned.length === 0 ? MARGIN * 2 : rowTops[lastRow] + rowHeights[lastRow] + MARGIN,
    columnsPerRow: perRow,
    boxes,
    edges,
  };
}
