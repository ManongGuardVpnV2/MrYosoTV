import { useState, useEffect } from 'react';

interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTV: boolean;
  screenWidth: number;
  screenHeight: number;
  orientation: 'portrait' | 'landscape';
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'tv';
}

export const useDeviceDetection = (): DeviceInfo => {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => getDeviceInfo());

  function getDeviceInfo(): DeviceInfo {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const userAgent = navigator.userAgent.toLowerCase();

    // Check for TV
    const isTV = /smart-tv|smarttv|googletv|appletv|hbbtv|pov_tv|netcast\.tv|webos|tizen|vidaa|viera|bravia|roku|firetv|androidtv/i.test(userAgent) ||
                 width >= 1920 && height >= 1080 && !('ontouchstart' in window);

    // Check for mobile
    const isMobile = /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent) && width < 768;

    // Check for tablet
    const isTablet = /ipad|android(?!.*mobile)|tablet/i.test(userAgent) || (width >= 768 && width < 1024);

    // Desktop is everything else
    const isDesktop = !isMobile && !isTablet && !isTV;

    // Determine device type
    let deviceType: 'mobile' | 'tablet' | 'desktop' | 'tv' = 'desktop';
    if (isTV) deviceType = 'tv';
    else if (isMobile) deviceType = 'mobile';
    else if (isTablet) deviceType = 'tablet';

    // Orientation
    const orientation = width > height ? 'landscape' : 'portrait';

    return {
      isMobile,
      isTablet,
      isDesktop,
      isTV,
      screenWidth: width,
      screenHeight: height,
      orientation,
      deviceType
    };
  }

  useEffect(() => {
    const handleResize = () => {
      setDeviceInfo(getDeviceInfo());
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return deviceInfo;
};

export default useDeviceDetection;
