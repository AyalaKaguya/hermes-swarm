import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Injectable } from "@nestjs/common";

@Injectable()
export class WorkerIdentityService {
  readonly id = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 160);
}
