// src/key-pool/types.ts
var NoAvailableKeyError = class extends Error {
  constructor(message = "No available API keys in pool") {
    super(message);
    this.name = "NoAvailableKeyError";
  }
};

export {
  NoAvailableKeyError
};
//# sourceMappingURL=chunk-6664ONDT.js.map