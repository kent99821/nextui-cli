import type {AppendKeyValue} from '@helpers/type';

import chalk from 'chalk';

import {checkIllegalComponents} from '@helpers/check';
import {detect} from '@helpers/detect';
import {exec} from '@helpers/exec';
import {Logger} from '@helpers/logger';
import {colorMatchRegex} from '@helpers/output-info';
import {getPackageInfo} from '@helpers/package';
import {upgrade} from '@helpers/upgrade';
import {getColorVersion, getPackageManagerInfo} from '@helpers/utils';
import {type NextUIComponents} from 'src/constants/component';
import {resolver} from 'src/constants/path';
import {NEXT_UI} from 'src/constants/required';
import {store} from 'src/constants/store';
import {getAutocompleteMultiselect, getMultiselect, getSelect} from 'src/prompts';
import {compareVersions, getLatestVersion} from 'src/scripts/helpers';

interface UpgradeActionOptions {
  packagePath?: string;
  all?: boolean;
  major?: boolean;
  minor?: boolean;
  patch?: boolean;
}

export async function upgradeAction(components: string[], options: UpgradeActionOptions) {
  const {all = false, packagePath = resolver('package.json')} = options;
  const {allDependencies, currentComponents} = getPackageInfo(packagePath, false);

  const isNextUIAll = !!allDependencies[NEXT_UI];

  const transformComponents: Required<
    AppendKeyValue<NextUIComponents[0], 'latestVersion', string> & {isLatest: boolean}
  >[] = [];

  for (const component of currentComponents) {
    const latestVersion =
      store.nextUIComponentsMap[component.name]?.version ||
      (await getLatestVersion(component.package));

    transformComponents.push({
      ...component,
      isLatest: compareVersions(component.version, latestVersion) >= 0,
      latestVersion
    });
  }

  // If no Installed NextUI components then exit
  if (!transformComponents.length && !isNextUIAll) {
    Logger.prefix('error', `No NextUI components detected in your package.json at: ${packagePath}`);

    return;
  }

  if (all) {
    components = currentComponents.map((component) => component.package);
  } else if (!components.length) {
    components = await getAutocompleteMultiselect(
      'Select the components to upgrade',
      transformComponents.map((component) => {
        const isUpToDate = component.version === component.latestVersion;

        return {
          disabled: isUpToDate,
          title: `${component.package} ${
            isUpToDate
              ? chalk.greenBright('Already up to date')
              : `${chalk.gray(`${component.version} ->`)} ${getColorVersion(
                  component.version,
                  component.latestVersion
                )}`
          }`,
          value: component.package
        };
      })
    );
  } else {
    // Check if the components are valid
    if (!checkIllegalComponents(components)) {
      return;
    }
  }

  components = components.map((c) => {
    if (store.nextUIComponentsMap[c]?.package) {
      return store.nextUIComponentsMap[c]!.package;
    }

    return c;
  });

  /** ======================== Upgrade ======================== */
  const upgradeOptionList = transformComponents.filter((c) => components.includes(c.package));

  let result = await upgrade({
    allDependencies,
    isNextUIAll,
    upgradeOptionList
  });
  let ignoreList: string[] = [];

  if (result.length) {
    const isExecute = await getSelect('Would you like to proceed with the upgrade?', [
      {
        title: 'Yes',
        value: true
      },
      {
        description: 'Turn to choose whether need to ignore some package upgrade',
        title: 'No',
        value: false
      }
    ]);

    const packageManager = await detect();
    const {install} = getPackageManagerInfo(packageManager);

    if (!isExecute) {
      // Ask whether need to remove some package not to upgrade
      const isNeedRemove = await getSelect('Do you want to ignore some package to upgrade?', [
        {
          description: 'Turn to choose components to ignore',
          title: 'Yes',
          value: true
        },
        {description: 'Upgrade exit', title: 'No', value: false}
      ]);

      if (isNeedRemove) {
        ignoreList = await getMultiselect(
          'Which components do you want to ignore?',
          result.map((c) => {
            return {
              description: `${c.version} -> ${getColorVersion(c.version, c.latestVersion)}`,
              title: c.package,
              value: c.package
            };
          })
        );
      }
    }

    // Remove the components that need to be ignored
    result = result.filter((r) => {
      return !ignoreList.some((ignore) => r.package === ignore);
    });

    await exec(
      `${packageManager} ${install} ${result.reduce((acc, component, index) => {
        return `${acc}${index === 0 ? '' : ' '}${
          component.package
        }@${component.latestVersion.replace(colorMatchRegex, '')}`;
      }, '')}`
    );
  }

  Logger.newLine();
  Logger.success('✅ Upgrade complete. All components are up to date.');

  process.exit(0);
}
