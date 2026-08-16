import { describe, expect, it } from 'vitest'

import { preflightHeaders } from '../src/index'

describe('CORS preflight', () => {
  it('allows the headers requested by browser OpenAI SDKs', () => {
    const request = new Request('https://vision.example/v1/chat/completions', {
      headers: {
        'access-control-request-headers': 'authorization,content-type,x-stainless-runtime,openai-project',
      },
      method: 'OPTIONS',
    })
    expect(preflightHeaders(request).get('access-control-allow-headers')).toBe(
      'authorization, content-type, x-stainless-runtime, openai-project',
    )
  })
})
