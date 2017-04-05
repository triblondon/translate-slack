
var tribTranslate = (function () {

	var msgListEl = document.getElementById('msgs_div');
	var targetLang = 'en';
	var maxTranslationsPerBatch = 5;
	var requestTimeout = 2000;
	var cache = new LRUCache(100);

	var translationServices = {
		mymm: function(encSrcText, srcLang, destLang) {
			return fetchWithTimeout("https://api.mymemory.translated.net/get?q="+encSrcText+"&langpair="+srcLang+"|"+targetLang+"&key=81e8eb6611458146ceab")
				.then(function(data) { return data.responseStatus == 200 ? data.responseData.translatedText : false; })
			;
		},
		ydex: function(encSrcText, srcLang, destLang) {
			return fetchWithTimeout("https://translate.yandex.net/api/v1.5/tr.json/translate?key=trnsl.1.1.20151206T000047Z.db445566a18d99bf.4f22c279c0857dff56abd6b8c696dea87677e530&text="+encSrcText+"&lang="+srcLang+"-"+targetLang+"&format=plain")
				.then(function(data) { return data.code == 200 ? data.text[0] : false; })
			;
		},
		goog: function(encSrcText, srcLang, destLang) {
			return fetchWithTimeout("https://www.googleapis.com/language/translate/v2?q="+encSrcText+"&target="+targetLang+"&source="+srcLang+"&format=text&key=AIzaSyDh9keNPMCwFxK7QUENDajHjtQKghsTLMg")
				.then(function(data) { return data.data.translations[0].translatedText; })
			;
		},
		msft: function(encSrcText, srcLang, destLang) {
			return fetchWithTimeout("https://api.microsofttranslator.com/v2/ajax.svc/TranslateArray?appId=%22Zwp2OyVlBkAqOO-WOV4lwh6R6gIOuW5DwaaL6yJ1RCYipaQnaH76AH5Kv0xeogrHtm72IcnqBsg5XvUIekxr0ikk_enslGrZ4JntwuSYozJ6NHMFDPuocVXww_2iLx5ph%22&texts=[%22"+encSrcText+"%22]&from=%22"+srcLang+"%22&to=%22"+targetLang+"%22&loc=en&ctr=&ref=WidgetV3CTF&rgp=f968b57")
				.then(function(data) { return data[0].TranslatedText; })
			;
		}
	};
	var reqStats = Object.keys(translationServices).reduce(function(out, serviceName) {
		out[serviceName] = {miss:0, hit:0};
		return out;
	}, {});

	function process() {

		// Find all elements that have not yet been translated
		// Limit translation batch size to avoid overloading the translation service (will gradually translate the whole history)
		var msgs = [].slice.call(msgListEl.querySelectorAll('ts-message:not(.tribtranslate)'), -maxTranslationsPerBatch);

		msgs.forEach(function(msgEl) {
			var bodyTextEl = msgEl.querySelector('.message_body:not(.msg_inline_file_preview_toggler)');
			var srcText;

			msgEl.classList.add('tribtranslate');

			if (!bodyTextEl || !bodyTextEl.innerHTML) {
				msgEl.setAttribute('data-tribtranslate-status', 'no-text');
				return;
			}

			srcText = bodyTextEl.innerHTML;
			msgEl.classList.add('tribtranslate');

			detectLang(srcText).then(function(srcLang) {
				if (srcLang === targetLang) {
					msgEl.setAttribute('data-tribtranslate-status', 'already-in-target-lang');
					throw new Error("Already in target lang");
				} else {
					msgEl.setAttribute('data-tribtranslate-status', 'in-progress');
					return translate(bodyTextEl.innerHTML, srcLang, targetLang)
				}
			})
			.then(function(translations) {
				observer.off();
				bodyTextEl.innerHTML = translations.map(function(translation) {
					return "<div class='tribtranslate__result'><div class='tribtranslate__service'>"+translation.serviceName+"</div><div class='tribtranslate__translatedtext'>"+translation.translatedText+"</div></div>";
				}).join('\n');
				msgEl.setAttribute('data-tribtranslate-status', 'done');
				observer.on();
			})
			.catch(function(err) {
				console.log(err);
			})
		});
	}

	function detectLang(srcText) {
		// Extremely naive solution, detects only Japanese that uses Hiragana or Katakana
		// Async since this would probably use a service for ambiguous alphabets
		return Promise.resolve(
			srcText.split('').filter(function(chr) {
				var charCode = chr.charCodeAt(0);
				return charCode >= 12353 && charCode <= 12543;
			}).length > 0 ? 'ja' : 'en'
		);
	}

	function translate(srcText, srcLang, targetLang) {
		var services = Object.keys(translationServices);
		return Promise.all(services.map(function(serviceName) {
			var cacheKey = hashString(serviceName+':'+srcText);
			var cacheResult = cache.get(cacheKey);
			if (cacheResult !== undefined) {
				reqStats[serviceName].hit++
				return cacheResult;
			} else {
				var p = translationServices[serviceName](encodeURIComponent(srcText), srcLang, targetLang);
				reqStats[serviceName].miss++
				cache.set(cacheKey, p);
				return p;
			}
		})).then(function(translations) {
			return translations.reduce(function(out, translatedText, idx) {
				if (translatedText) {
					out.push({serviceName: services[idx], translatedText: translatedText});
				}
				return out;
			}, []);
		});
	}

	function fetchWithTimeout(url) {
		return Promise.race([
			fetch(url).then(function(responseStream) { return responseStream.json(); }),
			new Promise(function(resolve, reject) {
				setTimeout(function() {
					reject(new Error('Timeout'));
				}, requestTimeout);
			})
		]);
	}

	function hashString(str) {
		var hash = 0, i, chr, len;
		if (str.length == 0) return hash;
		for (i = 0, len = str.length; i < len; i++) {
			chr   = str.charCodeAt(i);
			hash  = ((hash << 5) - hash) + chr;
			hash |= 0; // Convert to 32bit integer
		}
		return hash;
	};

	var observer = (function() {
		var _ob = new MutationObserver(function() { process(); });
		return {
			on: function() {
				_ob.observe(msgListEl, {subtree: true, childList: true});
			},
			off: function() {
				_ob.disconnect();
			}
		}
	}());

	observer.on();

	return {
		stats: function() {
			return reqStats;
		}
	};

}());
