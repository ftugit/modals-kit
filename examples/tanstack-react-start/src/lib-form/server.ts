import { createServerFn } from '@tanstack/react-start'
import { submitSignupOnServer } from './shared'

export const submitSignup = createServerFn({ method: 'POST' })
  .validator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error('Expected FormData')
    return data
  })
  .handler(async ({ data }) => submitSignupOnServer(data))
