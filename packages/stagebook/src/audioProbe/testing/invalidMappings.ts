// Shared malformed sidecars: host validation and real renderer must refuse each.
export const invalidMappings: unknown[] = [
  undefined,
  null,
  {},
  [],
  Array.from({ length: 9 }, (_, index) => ({
    index,
    role: "participant",
    position: index,
  })),
  [{ index: 1, role: "participant", position: 0 }],
  [
    { index: 1, role: "participant", position: 5 },
    { index: 1, role: "participant", position: 5 },
  ],
  [{ index: 0.5, role: "participant", position: 0 }],
  [{ index: 0, role: "mix_left" }],
  [{ index: 0, role: "mix_right" }],
  [{ index: 0, role: "other", position: 0 }],
  [{ index: 0, role: "participant" }],
  [{ index: 0, role: "participant", position: -1 }],
  [{ index: 0, role: "participant", position: 0.5 }],
  [{ index: 0, role: "participant", position: "0" }],
  [
    { index: 1, role: "participant", position: 5 },
    { ...{ index: 0, role: "participant", position: 0 }, position: 5 },
  ],
  [{ ...{ index: 0, role: "participant", position: 0 }, label: "" }],
  [{ ...{ index: 0, role: "participant", position: 0 }, label: "  " }],
  [{ ...{ index: 0, role: "participant", position: 0 }, label: 3 }],
  [null],
];
