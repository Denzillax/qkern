export type SqlValue = string | number | boolean | Date | Uint8Array | null | Record<string, unknown> | unknown[];

export type SqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export interface SqlQueryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly SqlValue[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface SqlPoolClient extends SqlQueryable {
  release(error?: Error | boolean): void;
}

export interface SqlPool extends SqlQueryable {
  connect(): Promise<SqlPoolClient>;
  end(): Promise<void>;
}
