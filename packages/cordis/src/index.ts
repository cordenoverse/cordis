import * as core from '@cordisjs/core'
import * as logger from '@cordisjs/logger'
import { TimerService } from '@cordisjs/timer'

export * from '@cordisjs/core'
export { default as Schema, default as z } from 'schemastery'
export { Logger } from '@cordisjs/logger'

export interface Events<C extends Context = Context> extends core.Events<C> {}

export namespace Context {
  export type Associate<P extends string, C extends Context = Context> = core.Context.Associate<P, C>
}

export interface Context {
  [Context.events]: Events<this>
}

export class Context extends core.Context {
  baseDir: string

  constructor(config?: any) {
    super(config)
    this.baseDir = globalThis.process?.cwd() || ''

    this.provide('logger', undefined, true)
    this.provide('timer', undefined, true)

    this.plugin(logger)
    this.plugin(TimerService)
  }
}

export abstract class Service<C extends Context = Context> extends core.Service<C> {
  static Context = Context

  public logger: logger.Logger

  constructor(ctx: C | undefined, name: string, options?: boolean | core.Service.Options) {
    super(ctx, name, options)
    this.logger = this.ctx.logger(name)
  }
}

export abstract class FunctionalService<C extends Context = Context> extends core.FunctionalService<C> {
  static Context = Context

  public logger: logger.Logger

  constructor(ctx: C | undefined, name: string, options?: boolean | core.Service.Options) {
    super(ctx, name, options)
    this.logger = this.ctx.logger(name)
  }
}

export default function () {}
