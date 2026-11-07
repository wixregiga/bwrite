// The envelope every answer of BWrite's Node process takes: the payload with `ok: true`, or a
// refusal naming its kind and a message for the author.

export interface Refusal<Kind extends string> {
  ok: false;
  problem: Kind;
  message: string;
}

export type Answer<T, Kind extends string> = ({ ok: true } & T) | Refusal<Kind>;
