import { before, describe, it } from "mocha";
import { expect } from "chai";
import { buildServerBundle } from "../scripts/Build";
import { join } from "path";
import type ServerManager from "../src/ServerManager/ServerManager";

describe("Server request lifecycle", () => {
  let Manager: typeof ServerManager;
  before(async () => {
    const bundle = join(__dirname, "../out/server-manager-test.js");
    buildServerBundle({ entryPoints: [join(__dirname, "../src/ServerManager/ServerManager.ts")], outfile: bundle });
    Manager = (await import(bundle)).default;
  });

  function manager() {
    // Isolate the request scheduler from document indexing and the transport.
    const errors: string[] = [];
    const server = Object.assign(Object.create(Manager.prototype), {
      stopping: false,
      workers: new Set(),
      pendingClientRequests: new Set(),
      logger: { error: (message: string) => errors.push(message) },
    }) as ServerManager;
    return { server, errors };
  }

  it("does not send a queued optional request after shutdown begins", async () => {
    const { server } = manager();
    let sent = false;
    const pending = server.optionalClientRequest("workspace/configuration", async () => {
      sent = true;
    });
    await server.down();
    await pending;
    expect(sent).to.equal(false);
  });

  it("absorbs a late rejection from a request cancelled during shutdown", async () => {
    const { server, errors } = manager();
    let rejectRequest: ((error: Error) => void) | undefined;
    const pending = server.optionalClientRequest(
      "workspace/configuration",
      async () =>
        await new Promise<void>((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    await Promise.resolve();
    await server.down();
    rejectRequest?.(new Error("Client disconnected"));
    await pending;
    await Promise.resolve();
    expect(errors).to.deep.equal([]);
  });
});
