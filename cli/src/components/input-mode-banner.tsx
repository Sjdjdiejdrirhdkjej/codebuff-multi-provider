import { CHATGPT_OAUTH_ENABLED } from '@codebuff/common/constants/chatgpt-oauth'
import { CLAUDE_OAUTH_ENABLED } from '@codebuff/common/constants/claude-oauth'
import React from 'react'
import { IS_FREEBUFF } from '../utils/constants'

import { ChatGptConnectBanner } from './chatgpt-connect-banner'
import { ClaudeConnectBanner } from './claude-connect-banner'
import { HelpBanner } from './help-banner'
import { PendingAttachmentsBanner } from './pending-attachments-banner'
import { useChatStore } from '../state/chat-store'

const BANNER_REGISTRY: Record<
  string,
  () => React.ReactNode
> = {
  default: () => <PendingAttachmentsBanner />,
  image: () => <PendingAttachmentsBanner />,
  help: () => <HelpBanner />,
  ...(CLAUDE_OAUTH_ENABLED && !IS_FREEBUFF
    ? { 'connect:claude': () => <ClaudeConnectBanner /> }
    : {}),
  ...(CHATGPT_OAUTH_ENABLED
    ? { 'connect:chatgpt': () => <ChatGptConnectBanner /> }
    : {}),
}

export const InputModeBanner = () => {
  const inputMode = useChatStore((state) => state.inputMode)
  const renderBanner = BANNER_REGISTRY[inputMode]
  if (!renderBanner) {
    return null
  }
  return <>{renderBanner()}</>
}
