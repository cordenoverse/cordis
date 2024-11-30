import { Mock, mock } from 'node:test'
import { expect } from 'chai'
import { Context } from '@cordisjs/core'
import MockLoader from './utils'

describe('group management: basic support', () => {
  const root = new Context()
  const dispose = mock.fn()

  let loader!: MockLoader
  let foo!: Mock<Function>

  before(async () => {
    await root.plugin(MockLoader)
    loader = root.loader as any

    foo = loader.mock('foo', (ctx: Context) => {
      ctx.on('dispose', dispose)
    })

    await loader.start()
  })

  beforeEach(() => {
    foo.mock.resetCalls()
    dispose.mock.resetCalls()
  })

  let outer!: string
  let inner!: string

  it('initialize', async () => {
    outer = await loader.create({
      name: 'cordis/group',
      group: true,
      config: [{
        name: 'foo',
      }],
    })

    inner = await loader.create({
      name: 'cordis/group',
      group: true,
      config: [{
        name: 'foo',
      }],
    }, outer)

    await loader.expectScope(outer)
    await loader.expectScope(inner)
    expect(foo.mock.calls).to.have.length(2)
    expect(dispose.mock.calls).to.have.length(0)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('disable inner', async () => {
    await loader.update(inner, { disabled: true })

    expect(foo.mock.calls).to.have.length(0)
    expect(dispose.mock.calls).to.have.length(1)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('disable outer', async () => {
    await loader.update(outer, { disabled: true })

    expect(foo.mock.calls).to.have.length(0)
    expect(dispose.mock.calls).to.have.length(1)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('enable inner', async () => {
    await loader.update(inner, { disabled: null })

    expect(foo.mock.calls).to.have.length(0) // outer is still disabled
    expect(dispose.mock.calls).to.have.length(0)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('enable outer', async () => {
    await loader.update(outer, { disabled: null })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(foo.mock.calls).to.have.length(2)
    expect(dispose.mock.calls).to.have.length(0)
    expect([...loader.entries()]).to.have.length(4)
  })
})

describe('group management: transfer', () => {
  const root = new Context()
  const dispose = mock.fn()

  let loader!: MockLoader
  let foo!: Mock<Function>

  before(async () => {
    await root.plugin(MockLoader)
    loader = root.loader as any

    foo = loader.mock('foo', (ctx: Context) => {
      ctx.on('dispose', dispose)
    })

    await loader.start()
  })

  beforeEach(() => {
    foo.mock.resetCalls()
    dispose.mock.resetCalls()
  })

  let alpha!: string
  let beta!: string
  let gamma!: string
  let id!: string

  it('initialize', async () => {
    id = await loader.create({
      name: 'foo',
    })

    alpha = await loader.create({
      name: 'cordis/group',
      group: true,
      config: [],
    })

    beta = await loader.create({
      name: 'cordis/group',
      group: true,
      disabled: true,
      config: [],
    }, alpha)

    gamma = await loader.create({
      name: 'cordis/group',
      group: true,
      config: [],
    }, beta)

    expect(foo.mock.calls).to.have.length(1)
    expect(dispose.mock.calls).to.have.length(0)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('enabled -> enabled', async () => {
    await loader.update(id, {}, alpha)

    expect(foo.mock.calls).to.have.length(0)
    expect(dispose.mock.calls).to.have.length(0)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('enabled -> disabled', async () => {
    await loader.update(id, {}, beta)

    expect(foo.mock.calls).to.have.length(0)
    expect(dispose.mock.calls).to.have.length(1)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('disabled -> disabled', async () => {
    await loader.update(id, {}, gamma)

    expect(foo.mock.calls).to.have.length(0) // outer is still disabled
    expect(dispose.mock.calls).to.have.length(0)
    expect([...loader.entries()]).to.have.length(4)
  })

  it('disabled -> enabled', async () => {
    await loader.update(id, {}, null)

    expect(foo.mock.calls).to.have.length(1)
    expect(dispose.mock.calls).to.have.length(0)
    expect([...loader.entries()]).to.have.length(4)
  })
})
