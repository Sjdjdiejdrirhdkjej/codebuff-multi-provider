import { processAndGrantCredit } from '@codebuff/billing'
import { NextResponse } from 'next/server'
import { extractApiKeyFromHeader } from '@/util/auth'
import { getUserInfoFromApiKey } from '@/db/user'
import { logger } from '@/util/logger'

export async function POST(req: Request) {
  try {
    const authToken = extractApiKeyFromHeader(req)

    if (!authToken) {
      return NextResponse.json(
        { message: 'Authentication required' },
        { status: 401 },
      )
    }

    const userInfo = await getUserInfoFromApiKey({
      apiKey: authToken,
      fields: ['id'],
      logger,
    })

    if (!userInfo) {
      return NextResponse.json(
        { message: 'Invalid API key' },
        { status: 401 },
      )
    }

    const userId = userInfo.id
    const amount = 1000
    const operationId = `manual-grant-${userId}-${Date.now()}`

    await processAndGrantCredit({
      userId,
      amount,
      type: 'admin',
      description: 'Manual credit grant via CLI',
      expiresAt: null,
      operationId,
      logger,
    })

    return NextResponse.json({
      success: true,
      message: `Successfully added ${amount} credits to your account.`,
      amount,
    })
  } catch (error) {
    logger.error({ error }, 'Error in /api/v1/credits/add')
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    )
  }
}
