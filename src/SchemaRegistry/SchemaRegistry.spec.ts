import { describe, expect, it } from "bun:test";
import SchemaRegistry from "./SchemaRegistry";

describe("SchemaRegistry", () => {
  it("should properly chunkify", () => {
    const registry = new SchemaRegistry();
    const input = [1, 2, 3, 4, 5, 6, 7];
    const chunks = registry.chunkify(input, 3);
    expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });
  it("should properly migrate indexes", async () => {
    class MockIndex {
      constructor(public id: number) {
        this.id = id;
      }
      getFullName() {
        return `index${this.id}`;
      }
      migrateIfNeeded = async () => {
        return { id: this.id, code: "MIGRATED" as const };
      };
    }
    const i1 = new MockIndex(1);
    const i2 = new MockIndex(2);
    const reg = new SchemaRegistry();
    // const thrower = () => {
    //   reg.migrateIfNeeded();
    // };
    // expect(thrower).toThrow(/No indexes/);
    // @ts-expect-error Just for unit testing
    reg.register(i1);
    // @ts-expect-error Just for unit testing
    reg.register(i2);
    const res = await reg.migrateIfNeeded(2);
    expect(res.success).toBe(true);
    expect(res.report).toEqual([
      {
        // @ts-expect-error  Just testing
        id: 1,
        code: "MIGRATED",
      },
      {
        // @ts-expect-error  Just testing
        id: 2,
        code: "MIGRATED",
      },
    ]);
    expect(res.summary).toEqual({
      index1: "MIGRATED",
      index2: "MIGRATED",
    });
  });
});
