import { Promisify, remove } from 'cosmokit'
import Logger from 'reggol'
import { Events, Session } from '.'
import { Context } from './context'
import { Disposable } from './plugin'

const logger = new Logger('app')

function isBailed(value: any) {
  return value !== null && value !== false && value !== undefined
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

class TaskQueue {
  #internal = new Set<Promise<void>>()

  queue(value: any) {
    const task = Promise.resolve(value)
      .catch(err => logger.warn(err))
      .then(() => this.#internal.delete(task))
    this.#internal.add(task)
  }

  async flush() {
    while (this.#internal.size) {
      await Promise.all(Array.from(this.#internal))
    }
  }
}

export namespace Lifecycle {
  export interface Config {
    maxListeners?: number
  }

  export interface Delegates {
    parallel<K extends EventName>(name: K, ...args: Parameters<Events[K]>): Promise<void>
    parallel<K extends EventName>(session: Session, name: K, ...args: Parameters<Events[K]>): Promise<void>
    emit<K extends EventName>(name: K, ...args: Parameters<Events[K]>): void
    emit<K extends EventName>(session: Session, name: K, ...args: Parameters<Events[K]>): void
    waterfall<K extends EventName>(name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>
    waterfall<K extends EventName>(session: Session, name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>
    chain<K extends EventName>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
    chain<K extends EventName>(session: Session, name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
    serial<K extends EventName>(name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>
    serial<K extends EventName>(session: Session, name: K, ...args: Parameters<Events[K]>): Promisify<ReturnType<Events[K]>>
    bail<K extends EventName>(name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
    bail<K extends EventName>(session: Session, name: K, ...args: Parameters<Events[K]>): ReturnType<Events[K]>
    on<K extends EventName>(name: K, listener: Events[K], prepend?: boolean): () => boolean
    once<K extends EventName>(name: K, listener: Events[K], prepend?: boolean): () => boolean
    before<K extends BeforeEventName>(name: K, listener: BeforeEventMap[K], append?: boolean): () => boolean
    off<K extends EventName>(name: K, listener: Events[K]): boolean
  }
}

export class Lifecycle {
  isActive = false
  _tasks = new TaskQueue()
  _hooks: Record<keyof any, [Context, (...args: any[]) => any][]> = {}

  constructor(private ctx: Context, private config: Lifecycle.Config) {}

  protected get caller(): Context {
    return this[Context.current] || this.ctx
  }

  protected* getHooks(name: EventName, session?: Session) {
    const hooks = this._hooks[name] || []
    for (const [context, callback] of hooks.slice()) {
      if (!context.match(session)) continue
      yield callback
    }
  }

  async parallel(...args: any[]) {
    const tasks: Promise<any>[] = []
    const session = typeof args[0] === 'object' ? args.shift() : null
    const name = args.shift()
    for (const callback of this.getHooks(name, session)) {
      tasks.push(Promise.resolve(callback.apply(session, args)).catch((error) => {
        logger.warn(error)
      }))
    }
    await Promise.all(tasks)
  }

  emit(...args: [any, ...any[]]) {
    this.parallel(...args)
  }

  async waterfall(...args: [any, ...any[]]) {
    const session = typeof args[0] === 'object' ? args.shift() : null
    const name = args.shift()
    for (const callback of this.getHooks(name, session)) {
      const result = await callback.apply(session, args)
      args[0] = result
    }
    return args[0]
  }

  chain(...args: [any, ...any[]]) {
    const session = typeof args[0] === 'object' ? args.shift() : null
    const name = args.shift()
    for (const callback of this.getHooks(name, session)) {
      const result = callback.apply(session, args)
      args[0] = result
    }
    return args[0]
  }

  async serial(...args: any[]) {
    const session = typeof args[0] === 'object' ? args.shift() : null
    const name = args.shift()
    for (const callback of this.getHooks(name, session)) {
      const result = await callback.apply(session, args)
      if (isBailed(result)) return result
    }
  }

  bail(...args: any[]) {
    const session = typeof args[0] === 'object' ? args.shift() : null
    const name = args.shift()
    for (const callback of this.getHooks(name, session)) {
      const result = callback.apply(session, args)
      if (isBailed(result)) return result
    }
  }

  on(name: EventName, listener: Disposable, prepend = false) {
    const method = prepend ? 'unshift' : 'push'

    // handle special events
    if (name === 'ready' && this.isActive) {
      this._tasks.queue(sleep(0).then(() => listener()))
      return () => false
    } else if (name === 'dispose') {
      this.caller.state.disposables[method](listener)
      return () => remove(this.caller.state.disposables, listener)
    }

    const hooks = this._hooks[name] ||= []
    if (hooks.length >= this.config.maxListeners) {
      logger.warn(
        'max listener count (%d) for event "%s" exceeded, which may be caused by a memory leak',
        this.config.maxListeners, name,
      )
    }

    hooks[method]([this.caller, listener])
    const dispose = () => {
      remove(this.caller.state.disposables, dispose)
      return this.off(name, listener)
    }
    this.caller.state.disposables.push(dispose)
    return dispose
  }

  once(name: EventName, listener: Disposable, prepend = false) {
    const dispose = this.on(name, function (...args: any[]) {
      dispose()
      return listener.apply(this, args)
    }, prepend)
    return dispose
  }

  before<K extends BeforeEventName>(name: K, listener: BeforeEventMap[K], append = false) {
    const seg = (name as string).split('/')
    seg[seg.length - 1] = 'before-' + seg[seg.length - 1]
    return this.on(seg.join('/') as EventName, listener, !append)
  }

  off<K extends EventName>(name: K, listener: Events[K]) {
    const index = (this._hooks[name] || [])
      .findIndex(([context, callback]) => context === this.caller && callback === listener)
    if (index >= 0) {
      this._hooks[name].splice(index, 1)
      return true
    }
  }

  async start() {
    this.isActive = true
    logger.debug('started')
    for (const callback of this.getHooks('ready')) {
      this._tasks.queue(callback())
    }
    delete this._hooks.ready
    await this._tasks.flush()
  }

  async stop() {
    this.isActive = false
    logger.debug('stopped')
    // `dispose` event is handled by ctx.disposables
    await Promise.all(this.ctx.state.disposables.map(dispose => dispose()))
  }
}

type EventName = keyof Events
type OmitSubstring<S extends string, T extends string> = S extends `${infer L}${T}${infer R}` ? `${L}${R}` : never
type BeforeEventName = OmitSubstring<EventName & string, 'before-'>

export type BeforeEventMap = { [E in EventName & string as OmitSubstring<E, 'before-'>]: Events[E] }
