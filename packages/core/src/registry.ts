import { defineProperty, Dict } from 'cosmokit'
import { Context } from './context.ts'
import { EffectScope } from './scope.ts'
import { isConstructor, resolveConfig, symbols, withProps } from './utils.ts'

function isApplicable(object: Plugin) {
  return object && typeof object === 'object' && typeof object.apply === 'function'
}

export type Inject = string[] | Dict<Inject.Meta>

export function Inject(inject: Inject) {
  return function (value: any, decorator: ClassDecoratorContext<any> | ClassMethodDecoratorContext<any>) {
    if (decorator.kind === 'class') {
      value.inject = inject
    } else if (decorator.kind === 'method') {
      decorator.addInitializer(function () {
        const property = this[symbols.tracker]?.property
        if (!property) throw new Error('missing context tracker')
        ;(this[symbols.initHooks] ??= []).push(() => {
          (this[property] as Context).inject(inject, (ctx) => {
            value.call(withProps(this, { [property]: ctx }))
          })
        })
      })
    } else {
      throw new Error('@Inject can only be used on class or class methods')
    }
  }
}

export namespace Inject {
  export interface Meta {
    required: boolean
  }

  export function resolve(inject: Inject | null | undefined) {
    if (!inject) return {}
    if (Array.isArray(inject)) {
      return Object.fromEntries(inject.map(name => [name, { required: true }]))
    }
    const { required, optional, ...rest } = inject
    if (Array.isArray(required)) {
      Object.assign(rest, Object.fromEntries(required.map(name => [name, { required: true }])))
    }
    if (Array.isArray(optional)) {
      Object.assign(rest, Object.fromEntries(optional.map(name => [name, { required: false }])))
    }
    return rest
  }
}

export type Plugin<C extends Context = Context, T = any> =
  | Plugin.Function<C, T>
  | Plugin.Constructor<C, T>
  | Plugin.Object<C, T>

export namespace Plugin {
  export interface Base<T = any> {
    name?: string
    reactive?: boolean
    reusable?: boolean
    Config?: (config: any) => T
    inject?: Inject
    provide?: string | string[]
    intercept?: Dict<boolean>
  }

  export interface Transform<S, T> {
    schema?: true
    Config: (config: S) => T
  }

  export interface Function<C extends Context = Context, T = any> extends Base<T> {
    (ctx: C, config: T): void | Promise<void>
  }

  export interface Constructor<C extends Context = Context, T = any> extends Base<T> {
    new (ctx: C, config: T): any
  }

  export interface Object<C extends Context = Context, T = any> extends Base<T> {
    apply: (ctx: C, config: T) => void | Promise<void>
  }

  export interface Meta<C extends Context = Context> {
    name?: string
    schema: any
    inject: Dict<Inject.Meta>
    isReactive?: boolean
    scopes: EffectScope<C>[]
    plugin: Plugin<C>
  }

  export function resolve<C extends Context = Context>(plugin: Plugin<C>): Meta<C> {
    let name = plugin.name
    if (name === 'apply') name = undefined
    const schema = plugin['Config'] || plugin['schema']
    const inject = Inject.resolve(plugin['using'] || plugin['inject'])
    const isReactive = plugin['reactive']
    return { name, schema, inject, isReactive, plugin, scopes: [] }
  }
}

export type Spread<T> = undefined extends T ? [config?: T] : [config: T]

declare module './context.ts' {
  export interface Context {
    /** @deprecated use `ctx.inject()` instead */
    using(deps: Inject, callback: Plugin.Function<this, void>): EffectScope<this>
    inject(deps: Inject, callback: Plugin.Function<this, void>): EffectScope<this>
    plugin<T = undefined, S = T>(plugin: Plugin.Function<this, T> & Plugin.Transform<S, T>, ...args: Spread<S>): EffectScope<this>
    plugin<T = undefined, S = T>(plugin: Plugin.Constructor<this, T> & Plugin.Transform<S, T>, ...args: Spread<S>): EffectScope<this>
    plugin<T = undefined, S = T>(plugin: Plugin.Object<this, T> & Plugin.Transform<S, T>, ...args: Spread<S>): EffectScope<this>
    plugin<T = undefined>(plugin: Plugin.Function<this, T>, ...args: Spread<T>): EffectScope<this>
    plugin<T = undefined>(plugin: Plugin.Constructor<this, T>, ...args: Spread<T>): EffectScope<this>
    plugin<T = undefined>(plugin: Plugin.Object<this, T>, ...args: Spread<T>): EffectScope<this>
  }
}

class Registry<C extends Context = Context> {
  private _counter = 0
  private _internal = new Map<Function, Plugin.Meta<C>>()
  protected context: Context

  constructor(public ctx: C, config: any) {
    defineProperty(this, symbols.tracker, {
      associate: 'registry',
      property: 'ctx',
    })

    this.context = ctx
  }

  get counter() {
    return ++this._counter
  }

  get size() {
    return this._internal.size
  }

  resolve(plugin: Plugin, assert: true): Function
  resolve(plugin: Plugin, assert?: boolean): Function | undefined
  resolve(plugin: Plugin, assert = false): Function | undefined {
    if (typeof plugin === 'function') return plugin
    if (isApplicable(plugin)) return plugin.apply
    if (assert) throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin)
  }

  get(plugin: Plugin) {
    const key = this.resolve(plugin)
    return key && this._internal.get(key)
  }

  has(plugin: Plugin) {
    const key = this.resolve(plugin)
    return !!key && this._internal.has(key)
  }

  delete(plugin: Plugin) {
    const key = this.resolve(plugin)
    const meta = key && this._internal.get(key)
    if (!meta) return
    this._internal.delete(key)
    return meta
  }

  keys() {
    return this._internal.keys()
  }

  values() {
    return this._internal.values()
  }

  entries() {
    return this._internal.entries()
  }

  forEach(callback: (value: Plugin.Meta<C>, key: Function) => void) {
    return this._internal.forEach(callback)
  }

  using(inject: Inject, callback: Plugin.Function<C, void>) {
    return this.inject(inject, callback)
  }

  inject(inject: Inject, callback: Plugin.Function<C, void>) {
    return this.plugin({ inject, apply: callback, name: callback.name })
  }

  plugin(plugin: Plugin<C>, config?: any, error?: any) {
    // check if it's a valid plugin
    const key = this.resolve(plugin, true)
    this.ctx.scope.assertActive()

    // resolve plugin config
    if (!error) {
      try {
        config = resolveConfig(plugin, config)
      } catch (reason) {
        this.context.emit(this.ctx, 'internal/error', reason)
        error = reason
        config = null
      }
    }

    const meta = Plugin.resolve<C>(plugin)
    this._internal.set(key!, meta)

    const scope = new EffectScope(this.ctx, config, async (ctx, config) => {
      if (typeof plugin !== 'function') {
        await plugin.apply(ctx, config)
      } else if (isConstructor(plugin)) {
        // eslint-disable-next-line new-cap
        const instance = new plugin(ctx, config)
        for (const hook of instance?.[symbols.initHooks] ?? []) {
          hook()
        }
        await instance?.[symbols.setup]?.()
      } else {
        await plugin(ctx, config)
      }
    }, meta)
    if (!config) {
      scope.cancel(error)
    } else {
      scope.start()
    }
    return scope
  }

  private async apply(plugin: Plugin, context: C, config: any) {
    if (typeof plugin !== 'function') {
      await plugin.apply(context, config)
    } else if (isConstructor(plugin)) {
      // eslint-disable-next-line new-cap
      const instance = new plugin(context, config)
      for (const hook of instance?.[symbols.initHooks] ?? []) {
        hook()
      }
      await instance?.[symbols.setup]?.()
    } else {
      await plugin(context, config)
    }
  }
}

export default Registry
