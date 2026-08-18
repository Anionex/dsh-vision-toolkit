// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetDisplayConfigCache } from '../src/client/display-config.ts'
import {
  installModelVariantsHider,
  tidyModelSelector,
} from '../src/client/model-variants-hider.ts'

function menuHtml(): string {
  return `
    <div role="menu">
      <section role="group" aria-labelledby=":r2:-deepseek-official">
        <div id=":r2:-deepseek-official" class="aTjPya_groupTitle">DeepSeek</div>
        <button role="menuitemradio" title="DeepSeek-V4-Flash"><span>DeepSeek-V4-Flash</span></button>
        <button role="menuitemradio" title="DeepSeek-V4-Pro"><span>DeepSeek-V4-Pro</span></button>
      </section>
      <section role="group" aria-labelledby=":r2:-openai">
        <div id=":r2:-openai" class="aTjPya_groupTitle">openai</div>
        <button role="menuitemradio" title="GPT-5.6 Sol"><span>GPT-5.6 Sol</span></button>
      </section>
      <section role="group" aria-labelledby=":r2:-vision-toolkit-deepseek-official">
        <div id=":r2:-vision-toolkit-deepseek-official" class="aTjPya_groupTitle">DeepSeek</div>
        <button role="menuitemradio" title="DeepSeek-V4-Flash"><span>DeepSeek-V4-Flash</span></button>
        <button role="menuitemradio" title="DeepSeek-V4-Pro"><span>DeepSeek-V4-Pro</span></button>
      </section>
    </div>
  `
}

function buttons(title: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[role="menuitemradio"][title="${title}"]`)]
}

afterEach(() => {
  document.body.innerHTML = ''
  resetDisplayConfigCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tidyModelSelector', () => {
  it('hides upstream entries that have a variant twin and collapses an empty upstream group', () => {
    document.body.innerHTML = menuHtml()
    tidyModelSelector()

    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('none')
    expect(buttons('DeepSeek-V4-Flash')[1]!.style.display).toBe('')
    expect(buttons('DeepSeek-V4-Pro')[0]!.style.display).toBe('none')
    expect(buttons('DeepSeek-V4-Pro')[1]!.style.display).toBe('')
    const upstream = document.querySelector('[aria-labelledby=":r2:-deepseek-official"]') as HTMLElement
    expect(upstream.style.display).toBe('none')
    const unrelated = document.querySelector('[aria-labelledby=":r2:-openai"]') as HTMLElement
    expect(unrelated.style.display).toBe('')
    expect(buttons('GPT-5.6 Sol')[0]!.style.display).toBe('')
  })

  it('keeps upstream entries that have no variant twin visible', () => {
    document.body.innerHTML = `
      <div role="menu">
        <section role="group" aria-labelledby=":r2:-deepseek-official">
          <div id=":r2:-deepseek-official"></div>
          <button role="menuitemradio" title="DeepSeek-V4-Flash"></button>
        </section>
        <section role="group" aria-labelledby=":r2:-vision-toolkit-deepseek-official">
          <div id=":r2:-vision-toolkit-deepseek-official"></div>
          <button role="menuitemradio" title="DeepSeek-V4-Pro"></button>
        </section>
      </div>
    `
    tidyModelSelector()
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('')
  })
})

describe('installModelVariantsHider', () => {
  it('hides twins only when transparent routing is enabled and restores on dispose', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, value: { hidden: true } }),
    })))
    document.body.innerHTML = menuHtml()

    const dispose = installModelVariantsHider()
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('none')

    dispose()
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('')
  })

  it('leaves the selector untouched when transparent routing is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, value: { hidden: false } }),
    })))
    document.body.innerHTML = menuHtml()

    const dispose = installModelVariantsHider()
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('')
    expect(buttons('DeepSeek-V4-Flash')[1]!.style.display).toBe('')
    dispose()
  })
})
