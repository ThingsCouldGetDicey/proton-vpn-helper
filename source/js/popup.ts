'use popup';
import {start} from './popup-starter';
import {accountURL} from './config';
import {triggerPromise} from './tools/triggerPromise';
import {handleError} from './tools/sentry';
import {installProtonSplitConsentUi} from './siteRouter/protonConsentUi';

((body) => {
	triggerPromise(start(body));
	installProtonSplitConsentUi();

	window.addEventListener(
		'message',
		(event: MessageEvent<string>) => {
			if (!event.origin.startsWith(accountURL)) {
				return;
			}

			if (event.data === 'endFork') {
				const accountFrame =
					body.querySelector<HTMLIFrameElement>('#account-frame');

				if (accountFrame) {
					accountFrame.style.display = 'none';
				}

				body.querySelectorAll<HTMLDivElement>('.main-area').forEach((area) => {
					area.style.display = 'block';
				});
			}
		},
		false,
	);

	window.addEventListener('unhandledrejection', handleError);
	window.addEventListener('error', handleError);
})(document.body);
