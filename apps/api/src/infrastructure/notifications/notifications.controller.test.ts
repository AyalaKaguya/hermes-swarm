import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";

describe("NotificationsController", () => {
  it("passes normalized list query options to the service", () => {
    let receivedOptions: unknown;
    const controller = new NotificationsController({
      listForAuthorization: (
        authorization: string | undefined,
        options: unknown,
      ) => {
        assert.equal(authorization, "Bearer token");
        receivedOptions = options;
        return [];
      },
    } as any);

    const result = controller.list("Bearer token", "unread", "20");

    assert.deepEqual(result, []);
    assert.deepEqual(receivedOptions, {
      status: "unread",
      take: 20,
    });
  });

  it("treats empty list query values as defaults", () => {
    let receivedOptions: unknown;
    const controller = new NotificationsController({
      listForAuthorization: (_authorization: string | undefined, options: unknown) => {
        receivedOptions = options;
        return [];
      },
    } as any);

    controller.list("Bearer token", "", "");

    assert.deepEqual(receivedOptions, {
      status: undefined,
      take: undefined,
    });
  });

  it("rejects invalid list status values", () => {
    const controller = new NotificationsController({
      listForAuthorization: () => {
        throw new Error("service should not be called");
      },
    } as any);

    assert.throws(
      () => controller.list("Bearer token", "archived", undefined),
      BadRequestException,
    );
  });

  it("rejects invalid list take values", () => {
    const controller = new NotificationsController({
      listForAuthorization: () => {
        throw new Error("service should not be called");
      },
    } as any);

    for (const take of ["abc", "10abc", "1.5", ["10"]]) {
      assert.throws(
        () => controller.list("Bearer token", undefined, take as any),
        BadRequestException,
      );
    }
  });
});
