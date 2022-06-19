import { App, Context, Service } from '../src'
import { noop } from 'cosmokit'
import { expect } from 'chai'
import * as jest from 'jest-mock'
import './shared'

describe('Service', () => {
  it('normal service', async () => {
    class Foo extends Service {
      constructor(ctx: Context) {
        super(ctx, 'foo')
      }
    }

    const app = new App()
    app.plugin(Foo)
    expect(app.foo).to.be.undefined

    await app.start()
    expect(app.foo).to.be.instanceOf(Foo)

    app.dispose(Foo)
    expect(app.foo).to.be.undefined
  })

  it('immediate service', async () => {
    class Foo extends Service {
      constructor(ctx: Context) {
        super(ctx, 'foo', true)
      }
    }

    const app = new App()
    app.plugin(Foo)
    expect(app.foo).to.be.instanceOf(Foo)
  })

  it('dependency update', async () => {
    const callback = jest.fn()
    const dispose = jest.fn(noop)

    const app = new App()
    app.using(['foo'], (ctx) => {
      callback(ctx.foo.bar)
      ctx.on('dispose', dispose)
    })

    expect(callback.mock.calls).to.have.length(0)
    expect(dispose.mock.calls).to.have.length(0)

    const old = app.foo = { bar: 100 }
    expect(callback.mock.calls).to.have.length(1)
    expect(callback.mock.calls[0][0]).to.equal(100)
    expect(dispose.mock.calls).to.have.length(0)

    // do not trigger event if reference has not changed
    old.bar = 200
    app.foo = old
    expect(callback.mock.calls).to.have.length(1)
    expect(dispose.mock.calls).to.have.length(0)

    app.foo = { bar: 300 }
    expect(callback.mock.calls).to.have.length(2)
    expect(callback.mock.calls[1][0]).to.equal(300)
    expect(dispose.mock.calls).to.have.length(1)

    app.foo = null
    expect(callback.mock.calls).to.have.length(2)
    expect(dispose.mock.calls).to.have.length(2)
  })

  it('lifecycle methods', async () => {
    const start = jest.fn(noop)
    const stop = jest.fn(noop)
    const fork = jest.fn(noop)

    class Foo extends Service {
      constructor(ctx: Context) {
        super(ctx, 'foo')
      }

      start = start
      stop = stop
      fork = fork
    }

    const app = new App()
    app.plugin(Foo)
    expect(start.mock.calls).to.have.length(0)
    expect(stop.mock.calls).to.have.length(0)
    expect(fork.mock.calls).to.have.length(1)

    await app.start()
    expect(start.mock.calls).to.have.length(1)
    expect(stop.mock.calls).to.have.length(0)
    expect(fork.mock.calls).to.have.length(1)

    app.plugin(Foo)
    expect(start.mock.calls).to.have.length(1)
    expect(stop.mock.calls).to.have.length(0)
    expect(fork.mock.calls).to.have.length(2)

    app.dispose(Foo)
    expect(start.mock.calls).to.have.length(1)
    expect(stop.mock.calls).to.have.length(1)
    expect(fork.mock.calls).to.have.length(2)
  })
})
