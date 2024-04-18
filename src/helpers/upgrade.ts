import type {RequiredKey, SAFE_ANY} from './type';

import chalk from 'chalk';

import {NEXT_UI, THEME_UI} from 'src/constants/required';
import {store} from 'src/constants/store';
import {type Dependencies, compareVersions} from 'src/scripts/helpers';

import {exec} from './exec';
import {Logger} from './logger';
import {outputBox} from './output-info';
import {getColorVersion, getVersionAndMode, transformPeerVersion} from './utils';

interface UpgradeOption {
  package: string;
  version: string;
  latestVersion: string;
  isLatest: boolean;
  versionMode: string;
  peerDependencies?: Dependencies;
}

const DEFAULT_SPACE = ''.padEnd(7);

interface Upgrade {
  isNextUIAll: boolean;
  allDependencies?: Record<string, SAFE_ANY>;
  upgradeOptionList?: UpgradeOption[];
}

type ExtractUpgrade<T extends Upgrade> = T extends {isNextUIAll: infer U}
  ? U extends true
    ? RequiredKey<Upgrade, 'allDependencies'>
    : RequiredKey<Upgrade, 'upgradeOptionList'>
  : T;

export async function upgrade<T extends Upgrade = Upgrade>(options: ExtractUpgrade<T>) {
  const {allDependencies, isNextUIAll, upgradeOptionList} = options as Required<Upgrade>;
  let result: UpgradeOption[] = [];
  const latestVersion = store.latestVersion;

  if (isNextUIAll) {
    const {currentVersion, versionMode} = getVersionAndMode(allDependencies, NEXT_UI);
    const colorVersion = getColorVersion(currentVersion, latestVersion);
    const isLatest = compareVersions(currentVersion, latestVersion) >= 0;

    const nextUIPeerDepList = await getPackagePeerDep(NEXT_UI, allDependencies);
    const nextUIThemePeerDepList = await getPackagePeerDep(THEME_UI, allDependencies);

    const outputList = [
      {
        isLatest,
        latestVersion: colorVersion,
        package: NEXT_UI,
        version: currentVersion,
        versionMode
      }
    ];
    const peerDepList = [...nextUIPeerDepList, ...nextUIThemePeerDepList];

    outputDependencies(outputList, peerDepList);

    if (!isLatest) {
      result.push(...outputList);

      result.push(...peerDepList.filter((c) => !c.isLatest));
    }
  } else {
    const transformUpgradeOptionList = upgradeOptionList.map((c) => ({
      ...c,
      latestVersion: getColorVersion(c.version, c.latestVersion)
    }));

    const upgradePeerList = await Promise.all(
      upgradeOptionList.map((upgradeOption) =>
        getPackagePeerDep(upgradeOption.package, allDependencies, upgradeOption.peerDependencies)
      )
    );

    const outputList = [...transformUpgradeOptionList];
    const peerDepList = [...upgradePeerList.flat()];

    outputDependencies(outputList, peerDepList);

    result = [...outputList, ...peerDepList].filter((upgradeOption) => !upgradeOption.isLatest);
  }

  return result;
}

/**
 * Get upgrade version
 * @param upgradeOptionList
 * @param peer Use for peerDependencies change the latest to fulfillment
 */
export function getUpgradeVersion(upgradeOptionList: UpgradeOption[], peer = false) {
  if (!upgradeOptionList.length) {
    return '';
  }

  const output: string[] = [];

  const optionMaxLenMap = {
    latestVersion: 0,
    package: 0,
    version: 0
  };

  for (const upgradeOption of upgradeOptionList) {
    for (const key in upgradeOption) {
      if (!Object.prototype.hasOwnProperty.call(upgradeOption, key)) {
        continue;
      }

      optionMaxLenMap[key] = Math.max(optionMaxLenMap[key], upgradeOption[key].length);

      if (key === 'version') {
        // Remove the duplicate character '^'
        upgradeOption[key] = upgradeOption[key].replace('^', '');
      }
    }
  }

  for (const upgradeOption of upgradeOptionList) {
    if (upgradeOption.isLatest) {
      if (peer) {
        // If it is peerDependencies, then skip output the latest version
        continue;
      }

      output.push(
        `  ${chalk.white(
          `${`${upgradeOption.package}@${upgradeOption.versionMode || ''}${
            upgradeOption.latestVersion
          }`.padEnd(optionMaxLenMap.package + DEFAULT_SPACE.length + DEFAULT_SPACE.length)}`
        )}${chalk.greenBright('latest').padStart(optionMaxLenMap.version)}${DEFAULT_SPACE}`
      );
      continue;
    }

    output.push(
      `  ${chalk.white(
        `${upgradeOption.package.padEnd(
          optionMaxLenMap.package + DEFAULT_SPACE.length
        )}${DEFAULT_SPACE}${`${upgradeOption.versionMode || ''}${upgradeOption.version}`.padEnd(
          optionMaxLenMap.version
        )}  ->  ${upgradeOption.versionMode || ''}${upgradeOption.latestVersion}`
      )}${DEFAULT_SPACE}`
    );
  }

  return output.join('\n');
}

async function getPackagePeerDep(
  packageName: string,
  allDependencies: Dependencies,
  peerDependencies?: Dependencies
): Promise<UpgradeOption[]> {
  peerDependencies =
    peerDependencies ||
    JSON.parse(
      (await exec(`npm show ${packageName} peerDependencies --json`, {
        logCmd: false,
        stdio: 'pipe'
      })) as SAFE_ANY
    ) ||
    {};

  if (!peerDependencies || !Object.keys(peerDependencies).length) {
    return [];
  }

  const upgradeOptionList: UpgradeOption[] = [];

  for (const [peerPackage, peerVersion] of Object.entries(peerDependencies)) {
    if (upgradeOptionList.some((c) => c.package === peerPackage)) {
      // Avoid duplicate
      continue;
    }

    const currentVersion = allDependencies[peerPackage];

    if (!currentVersion) {
      Logger.warn(`Missing peerDependencies: ${peerPackage}, check whether it is installed`);
      continue;
    }

    const {versionMode} = getVersionAndMode(allDependencies, peerPackage);
    let formatPeerVersion = transformPeerVersion(peerVersion);
    const isLatest = compareVersions(currentVersion, formatPeerVersion) >= 0;

    if (isLatest) {
      formatPeerVersion = transformPeerVersion(currentVersion);
    }

    upgradeOptionList.push({
      isLatest,
      latestVersion: isLatest
        ? formatPeerVersion
        : getColorVersion(currentVersion, formatPeerVersion),
      package: peerPackage,
      version: currentVersion,
      versionMode
    });
  }

  return upgradeOptionList;
}

function outputDependencies(outputList: UpgradeOption[], peerDepList: UpgradeOption[]) {
  const outputDefault = {
    components: {color: 'blue', text: '', title: chalk.blue('Components')},
    peerDependencies: {color: 'yellow', text: '', title: chalk.yellow('PeerDependencies')}
  } as const;

  const outputInfo = getUpgradeVersion(outputList);
  const outputPeerDepInfo = getUpgradeVersion(peerDepList, true);

  outputBox({...outputDefault.components, text: outputInfo});
  outputBox({...outputDefault.peerDependencies, text: outputPeerDepInfo});
}
