import { EmbedFieldData, MessageEmbed } from "discord.js";
import ESIIncursionState from "../models/esi/ESIIncursionState";
import IncursionsCacheEntry from "../models/bot/IncursionsCacheEntry";
import { noIncursionIconUrl } from "../config/icon_urls.json";

class EmbedMessageMapper {
  private readonly greenColor: number = 0x00b129;

  private readonly yellowColor: number = 0xff8000;

  private readonly redColor: number = 0xb11500;

  private readonly purpleColor: number = 0x5d0085;

  noIncursionToEmbedMessage(
    lastIncursion: IncursionsCacheEntry | null
  ): MessageEmbed {
    let spawnWindowField: EmbedFieldData;
    const now = new Date();

    if (lastIncursion != null) {
      const nextWindowDate = lastIncursion.updatedAt + 12 * 60 * 60 * 1000;
      const milliUntilNextWindow = nextWindowDate - now.getTime();

      if (milliUntilNextWindow > 0) {
        spawnWindowField = {
          name: "下一個入侵最快會在:",
          value: `${Math.round(milliUntilNextWindow / 1000 / 60 / 60)} 小時後 (<t:${Math.round(((milliUntilNextWindow / 1000) + (now.getTime() / 1000)))}> 
          | <t:${Math.round(((milliUntilNextWindow / 1000) + (now.getTime() / 1000)))}:R> )`,
        };
      } else {
        spawnWindowField = {
          name: "入侵冷卻期已經完結",
          value: "\u200B",
        };
      }
    } else {
      spawnWindowField = {
        name: "Next spawn window is currently not available.",
        value: "\u200B",
      };
    }

    return new MessageEmbed()
      .setAuthor({
        name: `暫時未有入侵`,
        url: `https://eve-incursions.de/`,
        iconURL: noIncursionIconUrl,
      })
      .setTitle(`下一個入侵將會12至36小時後出現`)
      .setDescription(`正在等待下一個入侵...`)
      .setColor(this.purpleColor)
      .addFields([spawnWindowField])
      .setFooter({
        text: `訊息最後更新： ${EmbedMessageMapper.dateToEveTimeString(
          now, false
        )}`,
      });
  }

  incursionInfoToEmbedMessage(incursionsCacheEntry: IncursionsCacheEntry): MessageEmbed {
    const now = new Date();
    let color: number = this.purpleColor;

    const { incursionInfo, createdAt } = incursionsCacheEntry;

    if (incursionInfo.state === ESIIncursionState.ESTABLISHED.toString()) {
      color = this.greenColor;
    } else if (
      incursionInfo.state === ESIIncursionState.MOBILIZING.toString()
    ) {
      color = this.yellowColor;
    } else if (
      incursionInfo.state === ESIIncursionState.WITHDRAWING.toString()
    ) {
      color = this.redColor;
    }

    const createAtDate = new Date(createdAt);
    let lastIncursionDistanceMessage = "N/A";

    if (incursionInfo.numberOfJumpsFromLastIncursion !== "N/A") {
      lastIncursionDistanceMessage = `${incursionInfo.lastIncursionSystemName} ${incursionInfo.numberOfJumpsFromLastIncursion}跳  `;
    }

    let description = '';
    if (incursionInfo.state === 'mobilizing' && incursionInfo.stateUpdatedAt) {
      // mobilizing+72hr
      const mobilizingStart = new Date(incursionInfo.stateUpdatedAt);
      const despawnDate = new Date(mobilizingStart.getTime() + 72 * 60 * 60 * 1000);
      description = `預計結束時間: ${EmbedMessageMapper.dateToEveTimeString(despawnDate, true)}`;
    } else if (incursionInfo.state === 'withdrawing' && incursionInfo.stateUpdatedAt) {
      // withdraw+24hr
      const withdrawingStart = new Date(incursionInfo.stateUpdatedAt);
      const despawnDate = new Date(withdrawingStart.getTime() + 24 * 60 * 60 * 1000);
      description = `預計結束時間: ${EmbedMessageMapper.dateToEveTimeString(despawnDate, true)}`;
    } else {
      description = `入侵開始時間: ${EmbedMessageMapper.dateToEveTimeString(createAtDate, true)}`;
    }

    let incursionsStateChinese = "";
    switch (incursionInfo.state) {
      case "established":
        incursionsStateChinese = "已建立據點";
        break;
      case "withdrawing":
        incursionsStateChinese = "正在撤退";
        break;
      case "mobilizing":
        incursionsStateChinese = "正在調動";
        break;
      default:
        incursionsStateChinese = "未知";
    }

    return new MessageEmbed()
      .setAuthor({
        name: `${incursionInfo.constellationName}`,
        url: `https://eve-incursions.de/`,
        iconURL: `${incursionInfo.regionIconUrl}`,
      })
      .setTitle(
        `${incursionInfo.constellationName}的入侵目前${incursionsStateChinese} (${incursionInfo.state})`
      )
      .setDescription(
        description
      )
      .setColor(color)
      .addFields([
        {
          name: "入侵資訊:",
          value: `**距離上一個入侵點:** ${lastIncursionDistanceMessage}\n**負面影響:** ${Math.round(
            incursionInfo.influence * 100
          )}%\n**高安島:** ${
            (incursionInfo.isIslandConstellation === "No" ? "否" : "是")
          }`,
          inline: true,
        },
        {
          name: `入侵星座:`,
          value: `**(總部) Headquarter:** ${
            incursionInfo.headquarterSystem
          }\n**(備戰) Staging:** ${
            incursionInfo.stagingSystem
          }\n**(先鋒) Vanguards:** ${incursionInfo.vanguardSystems.join(
            ", "
          )}\n**(突襲) Assaults:** ${incursionInfo.assaultSystems.join(", ")}`,
          inline: true,
        },
      ])
      .setFooter({
        text: `訊息最後更新： ${EmbedMessageMapper.dateToEveTimeString(
          now, false
        )}`,
      });
  }

  private static dateToEveTimeString(date: Date, discordFormattedTimestemp: boolean): string {
    const locale: Intl.LocalesArgument = "en-US";
    const options: Intl.NumberFormatOptions = { minimumIntegerDigits: 2 };
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth().toLocaleString(locale, options);
    const day = date.getUTCDate().toLocaleString(locale, options);
    const hours = date.getUTCHours().toLocaleString(locale, options);
    const minutes = date.getUTCMinutes().toLocaleString(locale, options);
    const epochTime = Math.floor(date.getTime() / 1000);

    return `${year}-${month}-${day} at ${hours}:${minutes} EVE Time ${discordFormattedTimestemp? ` (<t:${epochTime}:R>)` : ""}`;
  }
}

export default EmbedMessageMapper;
