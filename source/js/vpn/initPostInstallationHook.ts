import {isOauthAllowed} from '../account/partner/oauth';
import {getRuntime} from '../tools/getRuntime';


export const initPostInstallationHook = () => {
	const runtime = getRuntime();

	runtime?.onInstalled.addListener(async (details) => {
		if (await isOauthAllowed()) {
			return;
		}

		switch (details.reason) {
			case 'install':
				// The Helper is configured from its toolbar. Never open a tab
                // automatically when installed in the user's live profile.
                break;
		}
	});
};
