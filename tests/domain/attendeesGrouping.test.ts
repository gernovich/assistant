import { describe, expect, it } from "vitest";
import { groupAttendeePersonIds } from "../../src/domain/policies/attendeesGrouping";

describe("domain/policies/attendeesGrouping", () => {
  it("группирует по PARTSTAT и строит all (dedup)", () => {
    const toPid = (email: string) => `pid:${email.toLowerCase()}`;
    const g = groupAttendeePersonIds(
      [
        { email: "A@X.COM", partstat: "ACCEPTED" },
        { email: "b@x.com", partstat: "DECLINED" },
        { email: "c@x.com", partstat: "TENTATIVE" },
        { email: "d@x.com", partstat: "NEEDS-ACTION" },
        { email: "e@x.com", partstat: "SOMETHING" },
        { email: "a@x.com", partstat: "ACCEPTED" }, // повтор -> all dedup
      ],
      toPid,
    );

    expect(g.accepted).toEqual(["pid:a@x.com", "pid:a@x.com"]);
    expect(g.declined).toEqual(["pid:b@x.com"]);
    expect(g.tentative).toEqual(["pid:c@x.com"]);
    expect(g.needsAction).toEqual(["pid:d@x.com"]);
    expect(g.unknown).toEqual(["pid:e@x.com"]);
    expect(g.all.sort()).toEqual(["pid:a@x.com", "pid:b@x.com", "pid:c@x.com", "pid:d@x.com", "pid:e@x.com"].sort());
  });

  it("игнорирует пустые email", () => {
    const g = groupAttendeePersonIds([{ email: " " }, { email: "" }], (e) => e);
    expect(g.all).toEqual([]);
    expect(g.accepted).toEqual([]);
  });
});

