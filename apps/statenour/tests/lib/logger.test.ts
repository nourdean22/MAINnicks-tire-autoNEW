import { logger } from "@/lib/logger";

describe("logger", () => {
  it("logger.info does not throw", () => {
    expect(() => logger.info("test")).not.toThrow();
  });

  it("logger.error does not throw", () => {
    expect(() => logger.error("test")).not.toThrow();
  });

  it("withContext returns a new logger", () => {
    const child = logger.withContext({ route: "/api/test" });
    expect(child).toBeDefined();
    expect(child.info).toBeTypeOf("function");
    expect(child.error).toBeTypeOf("function");
    expect(child.withContext).toBeTypeOf("function");
  });

  it("time returns an object with a stop function", () => {
    const timer = logger.time("test");
    expect(timer).toBeDefined();
    expect(timer.stop).toBeTypeOf("function");
  });

  it("time().stop() returns a number (duration in ms)", () => {
    const timer = logger.time("test");
    const duration = timer.stop();
    expect(duration).toBeTypeOf("number");
    expect(duration).toBeGreaterThanOrEqual(0);
  });
});
