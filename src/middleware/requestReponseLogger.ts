/* eslint-disable no-console */
import type { Middleware, RequestContext, ResponseContext } from '@ipfs-shipyard/pinning-service-client'

import { responseHasContent } from '../utils/responseHasContent'
// import { streamToString } from '../utils/streamToString'
import { waitForDate } from '../utils/waitForDate'
import { getHostnameFromUrl } from '../utils/getHostnameFromUrl'
import type { ComplianceCheckDetailsCallbackArg } from '../types'

interface RequestResponseLoggerOptions {
  finalCb?: (details: ComplianceCheckDetailsCallbackArg) => void | Promise<void>
  preCb?: (context: RequestContext) => void | Promise<void>
  postCb?: (context: ResponseContext) => void | Promise<void>
}

const requestResponseLogger: (opts: RequestResponseLoggerOptions) => Middleware = ({ preCb, postCb, finalCb }) => {
  const rateLimitHandlers: Map<string, Array<Promise<void>>> = new Map()
  return ({
    pre: async (context) => {
      if (preCb != null) await preCb(context)
      const hostname = getHostnameFromUrl(context.url)
      if (rateLimitHandlers.has(hostname)) {
        const promises = rateLimitHandlers.get(hostname) as Array<Promise<void>>
        if (promises.length > 0) {
          await Promise.all(promises)
          rateLimitHandlers.set(hostname, [])
        }
      } else {
        rateLimitHandlers.set(hostname, [])
      }

      return context
    },

    post: async (context) => {
      if (postCb != null) await postCb(context)
      const { response } = context
      const errors: Error[] = []

      const hasContent = await responseHasContent(response)

      let text: string | null = null
      try {
        text = await response.clone().text()
      } catch (err) {
        errors.push(err as Error)
      }
      let json: any
      try {
        if (hasContent) {
          json = await response.clone().json()
        }
      } catch (err) {
        // debugger
        errors.push(err as Error)
      }

      const hostname = getHostnameFromUrl(context.url)
      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (response.headers.has('x-ratelimit-reset') && response.headers.has('x-ratelimit-remaining')) {
        const rateLimitReset = Number(response.headers.get('x-ratelimit-reset') as string)
        const dateOfReset = new Date(rateLimitReset * 1000)
        const rateLimit = Number(response.headers.get('x-ratelimit-limit') as string)
        const rateRemaining = Number(response.headers.get('x-ratelimit-remaining') as string)
        console.log(`${hostname}: Rate limit is ${rateLimit} and we have ${rateRemaining} tokens remaining.`)
        if (rateRemaining === 0) {
          console.log(`No rate tokens remaining.. we need to wait until ${dateOfReset.toString()}`)
          const promises = rateLimitHandlers.get(hostname) as Array<Promise<void>>
          promises.push(waitForDate(dateOfReset))
          // await
        }
      }
      try {
        const normalizedResult: ComplianceCheckDetailsCallbackArg = {
          ...context,
          url: context.url,
          init: context.init,
          fetch: context.fetch,
          errors,
          response: {
            ...response,
            json,
            // body,
            text
            // headers: response.headers,
            // status: response.status,
            // statusText: response.statusText,
            // ok: response.ok
          }
        }
        if (finalCb != null) await finalCb(normalizedResult)
      } catch (err) {
        console.error('error in callback provided to the middleware')
        console.error(err)
      }
      return response
    }
  })
}

export type { RequestResponseLoggerOptions }
export { requestResponseLogger }
