// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
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

function explicitMenuHtml(): string {
  return `
    <div role="menu">
      <section role="group" aria-labelledby=":r2:-deepseek-official">
        <div id=":r2:-deepseek-official" class="aTjPya_groupTitle">DeepSeek</div>
        <button role="menuitemradio" title="DeepSeek-V4-Flash"><span>DeepSeek-V4-Flash</span></button>
      </section>
      <section role="group" aria-labelledby=":r2:-vision-toolkit-deepseek-official">
        <div id=":r2:-vision-toolkit-deepseek-official" class="aTjPya_groupTitle">DeepSeek (Vision Toolkit)</div>
        <button role="menuitemradio" title="DeepSeek-V4-Flash (Vision Toolkit)"><span>DeepSeek-V4-Flash (Vision Toolkit)</span></button>
      </section>
    </div>
  `
}

function buttons(title: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[role="menuitemradio"][title="${title}"]`)]
}

afterEach(() => {
  document.body.innerHTML = ''
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

  it('restores upstream entries when variant twins switch to explicit names', () => {
    document.body.innerHTML = menuHtml()
    tidyModelSelector()
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('none')
    expect(buttons('DeepSeek-V4-Pro')[0]!.style.display).toBe('none')

    // Simulate the adapter rebuild after transparent routing is disabled:
    // the variant twins keep the same DOM nodes but gain explicit suffixes.
    const variantGroup = document.querySelector('[aria-labelledby=":r2:-vision-toolkit-deepseek-official"]') as HTMLElement
    const variantTitle = variantGroup.querySelector(':scope > div') as HTMLElement
    variantTitle.textContent = 'DeepSeek (Vision Toolkit)'
    for (const button of variantGroup.querySelectorAll<HTMLElement>('[role="menuitemradio"]')) {
      const span = button.querySelector('span')
      if (span !== null) span.textContent = `${span.textContent}(Vision Toolkit)`
      button.setAttribute('title', `${button.getAttribute('title')}(Vision Toolkit)`)
    }
    tidyModelSelector()

    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('')
    expect(buttons('DeepSeek-V4-Pro')[0]!.style.display).toBe('')
    const upstream = document.querySelector('[aria-labelledby=":r2:-deepseek-official"]') as HTMLElement
    expect(upstream.style.display).toBe('')
  })
})

describe('installModelVariantsHider', () => {
  it('hides twin entries immediately and restores them on dispose', () => {
    document.body.innerHTML = menuHtml()

    const dispose = installModelVariantsHider()
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('none')
    expect(buttons('DeepSeek-V4-Flash')[1]!.style.display).toBe('')

    dispose()
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('')
  })

  it('hides twin entries rendered after install before the next paint', async () => {
    document.body.innerHTML = ''

    const dispose = installModelVariantsHider()
    document.body.innerHTML = menuHtml()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('none')
    expect(buttons('DeepSeek-V4-Flash')[1]!.style.display).toBe('')
    dispose()
  })

  it('keeps explicit variant entries untouched', () => {
    document.body.innerHTML = explicitMenuHtml()

    const dispose = installModelVariantsHider()
    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('')
    expect(buttons('DeepSeek-V4-Flash (Vision Toolkit)')[0]!.style.display).toBe('')
    dispose()
  })

  it('ignores a queued tidy after dispose', async () => {
    document.body.innerHTML = menuHtml()
    const dispose = installModelVariantsHider()
    document.body.innerHTML = ''
    dispose()
    document.body.innerHTML = menuHtml()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('')
  })

  it('keeps the first integrator when installed twice', async () => {
    document.body.innerHTML = ''
    const disposeFirst = installModelVariantsHider()
    const disposeSecond = installModelVariantsHider()

    // A duplicate effect must not tear down the active integrator.
    disposeSecond()
    document.body.innerHTML = menuHtml()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(buttons('DeepSeek-V4-Flash')[0]!.style.display).toBe('none')
    disposeFirst()
  })
})
