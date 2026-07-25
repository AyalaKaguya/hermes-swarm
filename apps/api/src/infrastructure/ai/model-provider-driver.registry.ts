import { Injectable } from "@nestjs/common";
import {
  ModelProviderDriverRegistryError,
  type ModelProviderDriver,
  type ModelProviderDriverDescriptor,
} from "./model-provider-driver.js";

const DRIVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,47}$/;

@Injectable()
export class ModelProviderDriverRegistry {
  private readonly drivers = new Map<string, ModelProviderDriver>();

  constructor(drivers: readonly ModelProviderDriver[] = []) {
    for (const driver of drivers) this.register(driver);
  }

  register(driver: ModelProviderDriver) {
    const driverId = driver.descriptor.driver;
    if (!DRIVER_ID_PATTERN.test(driverId)) {
      throw new ModelProviderDriverRegistryError(
        "AI_PROVIDER_DRIVER_INVALID",
        "Model provider driver has an invalid stable identifier",
      );
    }
    if (this.drivers.has(driverId)) {
      throw new ModelProviderDriverRegistryError(
        "AI_PROVIDER_DRIVER_DUPLICATE",
        `Model provider driver is already registered: ${driverId}`,
      );
    }
    this.drivers.set(driverId, driver);
    return this;
  }

  resolve(driverId: string) {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      throw new ModelProviderDriverRegistryError(
        "AI_PROVIDER_DRIVER_UNKNOWN",
        `Model provider driver is not registered: ${driverId}`,
      );
    }
    return driver;
  }

  has(driverId: string) {
    return this.drivers.has(driverId);
  }

  list(): readonly ModelProviderDriverDescriptor[] {
    return [...this.drivers.values()]
      .map(({ descriptor }) => Object.freeze({
        ...descriptor,
        capabilities: Object.freeze([...descriptor.capabilities]),
      }))
      .sort((left, right) => left.driver.localeCompare(right.driver));
  }
}
