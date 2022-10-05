import { Bot, Context, Quester, Schema, segment, Session } from '@satorijs/satori'
import { Method } from 'axios'
import { adaptAuthor, adaptGroup, adaptUser } from './utils'
import * as Kook from './types'
import FormData from 'form-data'
import { WsClient } from './ws'
import { HttpServer } from './http'
import { Sender } from './sender'

export class KookBot<C extends Context = Context, T extends KookBot.Config = KookBot.Config> extends Bot<C, T> {
  http: Quester
  internal: Kook.Internal

  constructor(ctx: C, config: T) {
    super(ctx, config)
    this.http = ctx.http.extend({
      headers: {
        'Authorization': `Bot ${config.token}`,
        'Content-Type': 'application/json',
      },
    }).extend(config)
    this.internal = new Kook.Internal(this.http)

    if (config.protocol === 'http') {
      ctx.plugin(HttpServer, this)
    } else if (config.protocol === 'ws') {
      ctx.plugin(WsClient, this)
    }
  }

  async request<T = any>(method: Method, path: string, data?: any, headers: any = {}): Promise<T> {
    data = data instanceof FormData ? data : JSON.stringify(data)
    return (await this.http(method, path, { data, headers })).data
  }

  async sendMessage(channelId: string, content: string | segment, guildId?: string) {
    const fragment = segment.normalize(content)
    const elements = fragment.children
    content = fragment.toString()
    const session = this.session({
      type: 'send',
      author: this,
      channelId,
      elements,
      content,
      guildId,
      subtype: guildId ? 'group' : 'private',
    })

    if (await this.context.serial(session, 'before-send', session)) return
    if (!session.content) return []

    const sender = new Sender(this, channelId)
    const results = await sender.send(session.content)

    for (const id of results) {
      session.messageId = id
      this.context.emit(session, 'send', session)
    }

    return results
  }

  async sendPrivateMessage(target_id: string, content: string | segment) {
    const { code } = await this.request('POST', '/user-chat/create', { target_id })
    return this.sendMessage(code, content)
  }

  async deleteMessage(channelId: string, msg_id: string) {
    if (channelId.length > 30) {
      await this.request('POST', '/user-chat/delete-msg', { msg_id })
    } else {
      await this.request('POST', '/message/delete', { msg_id })
    }
  }

  async editMessage(channelId: string, msg_id: string, content: string | segment) {
    content = segment.normalize(content).toString()
    if (channelId.length > 30) {
      await this.request('POST', '/user-chat/update-msg', { msg_id, content })
    } else {
      await this.request('POST', '/message/update', { msg_id, content })
    }
  }

  async $createReaction(channelId: string, msg_id: string, emoji: string) {
    if (channelId.length > 30) {
      await this.request('POST', '/direct-message/add-reaction', { msg_id, emoji })
    } else {
      await this.request('POST', '/message/add-reaction', { msg_id, emoji })
    }
  }

  async $deleteReaction(channelId: string, messageId: string, emoji: string, user_id?: string) {
    if (channelId.length > 30) {
      await this.request('POST', '/direct-message/delete-reaction', { msg_id: messageId, emoji })
    } else {
      await this.request('POST', '/message/delete-reaction', { msg_id: messageId, emoji, user_id })
    }
  }

  async getSelf() {
    const data = adaptUser(await this.request<Kook.Self>('GET', '/user/me'))
    data['selfId'] = data.userId
    delete data.userId
    return data
  }

  async getGuildList() {
    const { items } = await this.request<Kook.GuildList>('GET', '/guild/list')
    return items.map(adaptGroup)
  }

  async getGuildMemberList() {
    const { items } = await this.request<Kook.GuildMemberList>('GET', '/guild/user-list')
    return items.map(adaptAuthor)
  }

  async setGroupNickname(guild_id: string, user_id: string, nickname: string) {
    await this.request('POST', '/guild/nickname', { guild_id, user_id, nickname })
  }

  async leaveGroup(guild_id: string) {
    await this.request('POST', '/guild/leave', { guild_id })
  }

  async kickGroup(guild_id: string, user_id: string) {
    await this.request('POST', '/guild/kickout', { guild_id, user_id })
  }
}

export namespace KookBot {
  export interface BaseConfig extends Bot.Config, Quester.Config, Sender.Config {}

  export type Config = BaseConfig & (HttpServer.Config | WsClient.Config)

  export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
      protocol: Schema.union(['http', 'ws']).description('选择要使用的协议。').required(),
    }),
    Schema.union([
      WsClient.Config,
      HttpServer.Config,
    ]),
    Sender.Config,
    Quester.createConfig('https://www.kookapp.cn/api/v3'),
  ] as const)
}

// for backward compatibility
KookBot.prototype.platform = 'kook'
