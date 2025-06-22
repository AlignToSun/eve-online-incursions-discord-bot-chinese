import ESISystem from "../models/esi/ESISystem";
import ESIConstellation from "../models/esi/ESIConstellation";
import ESIService from "./ESIService";
import { highSecOnly } from "../config/config.json";
import IncursionConstellationLayout from "../models/bot/IncursionConstellationLayout";
import IncursionInfo from "../models/bot/IncursionInfo";
import ESIIncursion from "../models/esi/ESIIncursion";
import RegionIconService from "./RegionIconService";
import IncursionLayoutService from "./IncursionLayoutService";
import ESIResponse from "../models/esi/ESIResponse";
import IncursionsCacheService from "./IncursionsCacheService";

class IncursionInfoService {
  private readonly esiService: ESIService;

  private readonly regionIconService: RegionIconService;

  private readonly incursionLayoutService: IncursionLayoutService;

  private readonly esiSystemInfoByIdDict: { [systemId: number]: ESISystem };

  private readonly esiSystemInfoByNameDict: { [systemName: string]: ESISystem };

  private readonly esiConstellationInfoDict: {
    [constellationId: number]: ESIConstellation;
  };

  private esiIncursionCacheExpireDate: Date;

  private stateChangeTimestamps: { [constellationId: number]: { [state: string]: string } } = {};

  private incursionsCacheService: IncursionsCacheService;

  constructor(
    _esiService: ESIService,
    _regionIconService: RegionIconService,
    _incursionLayoutService: IncursionLayoutService,
    incursionsCacheService?: IncursionsCacheService
  ) {
    this.esiService = _esiService;
    this.regionIconService = _regionIconService;
    this.incursionLayoutService = _incursionLayoutService;
    this.esiSystemInfoByIdDict = {};
    this.esiSystemInfoByNameDict = {};
    this.esiConstellationInfoDict = {};
    this.esiIncursionCacheExpireDate = new Date();
    this.incursionsCacheService = incursionsCacheService || new IncursionsCacheService();

    // 載入持久化的 stateChangeTimestamps
    this.stateChangeTimestamps = this.incursionsCacheService.getStateChangeTimestamps();
  }

  async findAllIncursionsInfo(
    lastIncursionInfo: IncursionInfo | null
  ): Promise<IncursionInfo[] | null> {
    const esiResponse: ESIResponse<ESIIncursion[]> | null =
      await this.esiService.getIncursionsInfo();

    if (esiResponse == null) {
      this.esiIncursionCacheExpireDate = new Date(Date.now() + 60 * 1000);
      return null;
    }

    const esiIncursionInfos: ESIIncursion[] = esiResponse.data;
    this.esiIncursionCacheExpireDate = new Date(esiResponse.headers.expires);

    await this.prepareIncursionsData(esiIncursionInfos);

    const incursionInfos: IncursionInfo[] = [];
    const promiseList: Promise<void>[] = [];

    esiIncursionInfos.forEach((esiIncursion) => {
      promiseList.push(
        this.findCompletedIncursionInfo(esiIncursion, lastIncursionInfo).then(
          (incursionInfo) => {
            if (incursionInfo != null) {
              incursionInfos.push(incursionInfo);
            }
          }
        )
      );
    });

    await Promise.all(promiseList);

    return incursionInfos;
  }

  getEsiIncursionCacheExpireDate(): Date {
    return this.esiIncursionCacheExpireDate;
  }

  async prepareIncursionsData(esiIncursionInfos: ESIIncursion[]) {
    const promiseList: Promise<void>[] = [];

    esiIncursionInfos.forEach((esiIncursion) => {
      promiseList.push(
        this.esiService
          .getConstellationInfo(esiIncursion.constellation_id)
          .then((esiResponse) => {
            if (esiResponse != null) {
              const esiConstellation = esiResponse.data;

              this.esiConstellationInfoDict[esiConstellation.constellation_id] =
                esiConstellation;
            }
          })
      );

      promiseList.push(
        this.esiService
          .getSystemInfo(esiIncursion.staging_solar_system_id)
          .then((esiResponse) => {
            if (esiResponse != null) {
              const esiSystem = esiResponse.data;

              this.esiSystemInfoByIdDict[esiSystem.system_id] = esiSystem;
              this.esiSystemInfoByNameDict[esiSystem.name] = esiSystem;
            }
          })
      );

      esiIncursion.infested_solar_systems.forEach((infestedSolarSystem) => {
        promiseList.push(
          this.esiService
            .getSystemInfo(infestedSolarSystem)
            .then((esiResponse) => {
              if (esiResponse != null) {
                const esiSystem = esiResponse.data;

                this.esiSystemInfoByIdDict[esiSystem.system_id] = esiSystem;
                this.esiSystemInfoByNameDict[esiSystem.name] = esiSystem;
              }
            })
        );
      });
    });

    await Promise.all(promiseList);
  }

  private async findCompletedIncursionInfo(
    esiIncursion: ESIIncursion,
    lastIncursionInfo: IncursionInfo | null
  ): Promise<IncursionInfo | null> {
    const constellationInfo: ESIConstellation | undefined =
      this.esiConstellationInfoDict[esiIncursion.constellation_id];
    const stagingSolarSystemInfo: ESISystem | undefined =
      this.esiSystemInfoByIdDict[esiIncursion.staging_solar_system_id];
    const infestedSolarSystems: string[] = [];

    esiIncursion.infested_solar_systems.forEach((infestedSolarSystemId) => {
      const infestedSolarSystemInfo: ESISystem | undefined =
        this.esiSystemInfoByIdDict[infestedSolarSystemId];

      if (infestedSolarSystemInfo !== undefined) {
        infestedSolarSystems.push(infestedSolarSystemInfo.name);
      }
    });

    let stateUpdatedAt: string | undefined = undefined;
    // 狀態追蹤與紀錄
    const constellationId = esiIncursion.constellation_id;
    const currentState = esiIncursion.state;
    if (!this.stateChangeTimestamps[constellationId]) {
      this.stateChangeTimestamps[constellationId] = {};
    }
    if (!this.stateChangeTimestamps[constellationId][currentState]) {
      // 新狀態第一次出現，紀錄當前時間
      this.stateChangeTimestamps[constellationId][currentState] = new Date().toISOString();
      // 持久化
      this.incursionsCacheService.setStateChangeTimestamps(this.stateChangeTimestamps);
    }
    stateUpdatedAt = this.stateChangeTimestamps[constellationId][currentState];

    if (
      constellationInfo === undefined ||
      stagingSolarSystemInfo === undefined ||
      infestedSolarSystems.length !== esiIncursion.infested_solar_systems.length
    ) {
      console.error(
        `Missing information for incursion: ${JSON.stringify(esiIncursion)}`
      );
    } else if (
      !highSecOnly ||
      (highSecOnly && stagingSolarSystemInfo.security_status >= 0.45)
    ) {
      let regionIconUrl = this.regionIconService.findRegionIconUrl(
        constellationInfo.region_id
      );
      const incursionConstellationLayout: IncursionConstellationLayout | null =
        this.incursionLayoutService.findIncursionLayout(constellationInfo.name);

      if (regionIconUrl == null) {
        regionIconUrl = "";
      }

      let stagingSystem = "N/A";
      let headquarterSystem = "N/A";
      let headquarterSystemId: number | null = null;
      let vanguardSystems = ["N/A"];
      let assaultSystems = ["N/A"];
      let isIslandConstellation = "N/A";
      let numberOfJumpsFromLastIncursion = "N/A";
      let lastIncursionSystemName = "N/A";

      if (incursionConstellationLayout != null) {
        stagingSystem = incursionConstellationLayout.staging_system;
        headquarterSystem = incursionConstellationLayout.headquarter_system;
        headquarterSystemId =
          this.esiSystemInfoByNameDict[
            incursionConstellationLayout.headquarter_system
          ].system_id;
        vanguardSystems = incursionConstellationLayout.vanguard_systems;
        assaultSystems = incursionConstellationLayout.assault_systems;
        isIslandConstellation =
          incursionConstellationLayout.is_island_constellation ? "Yes" : "No";

        if (lastIncursionInfo != null) {
          if (lastIncursionInfo.headquarterSystemId != null) {
            const esiResponse = await this.esiService.getRouteInfo(
              lastIncursionInfo.headquarterSystemId,
              headquarterSystemId
            );

            if (esiResponse != null) {
              const route = esiResponse.data;

              numberOfJumpsFromLastIncursion = (route.length - 1).toString();
            }
          }

          lastIncursionSystemName = lastIncursionInfo.headquarterSystem;
        }
      }

      return {
        regionIconUrl,
        constellationName: constellationInfo.name,
        constellationId: esiIncursion.constellation_id,
        headquarterSystem,
        headquarterSystemId,
        stagingSystem,
        vanguardSystems,
        assaultSystems,
        numberOfJumpsFromLastIncursion,
        influence: 1 - esiIncursion.influence,
        state: esiIncursion.state,
        isIslandConstellation,
        lastIncursionSystemName,
        stateUpdatedAt, // 新增狀態更新時間
      };
    }

    return null;
  }
}

export default IncursionInfoService;
