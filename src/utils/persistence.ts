
import { useSyncExternalStore, useCallback } from 'react';

function useUrlOrLocalState(
  {urlKey, localKey = null, defaultValue, validValues = null} :
  {
    urlKey: string | null, localKey? : string | null,
    defaultValue : string, validValues?: string[] | null
  }
): [string, (value: string) => void] {

  const getSnapshot = () => {
    if(urlKey === null)
    {
      const hashValue = window.location.hash.replace('#', '');
      if (validValues === null || validValues.includes(hashValue))
      {
        return hashValue;
      }
    } else {
      const params = new URLSearchParams(window.location.search);
      const paramValue = params.get(urlKey);
      if (paramValue !== null) {
        if (validValues === null || validValues.includes(paramValue))
        {
          return paramValue;
        }
      }
    }
    if (localKey !== null) {
      const stored = localStorage.getItem(localKey);
      if (stored !== null) {
        if (validValues === null || validValues.includes(stored))
        {
          return stored;
        }
      }
    }
    return defaultValue;
  };

  const setValue = useCallback((value: string) => {
    // Update URL param
    const currentHash = window.location.hash;
    var newHash: string|null = null;
    const params = new URLSearchParams(window.location.search);

    if (urlKey !== null)
    {
      if (value === defaultValue){
        params.delete(urlKey);
      } else {
        params.set(urlKey, value);
      }
    } else {
      newHash = "#" + value;
    }
    
    const paramString = params.toString();
    const newUrl = `${window.location.pathname}${paramString !== '' ? '?' + paramString : ''}${newHash ?? currentHash}`
    window.history.replaceState(null, '', newUrl);

    // Update localStorage if needed
    if (localKey !== null) {
      if (value === defaultValue)
      {
        localStorage.removeItem(localKey)
      }
      else
      {
        localStorage.setItem(localKey, value);
      }
    }
    window.dispatchEvent(new CustomEvent("useUrlOrLocalState"))
  }, [urlKey, localKey, defaultValue]);

  const subscribe = (onStoreChange: () => void) => {
    console.log('subscribe')
    const callback = () => {
      console.log("hi")
      onStoreChange();
    }
    window.addEventListener('popstate', callback);
    window.addEventListener('hashchange', callback);
    window.addEventListener('useUrlOrLocalState', callback);
    return () => {
      window.removeEventListener('popstate', callback);
      window.removeEventListener('hashchange', callback);
    window.addEventListener('useUrlOrLocalState', callback);
    };
  };

  const state = useSyncExternalStore(subscribe, getSnapshot);

  return [state, setValue];
}
export default useUrlOrLocalState;