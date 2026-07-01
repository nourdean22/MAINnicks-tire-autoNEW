import { useState, useEffect } from "react";
import { today } from "@/lib/utils/datetime";

export function useCommanderGreeting() {
  const [timeStr, setTimeStr] = useState<string>("");
  const [greeting, setGreeting] = useState<string>("Welcome");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }));
      
      const hour = now.getHours();
      if (hour < 12) setGreeting("Good Morning");
      else if (hour < 17) setGreeting("Good Afternoon");
      else setGreeting("Good Evening");
    };
    
    updateTime();
    const timer = setInterval(updateTime, 60000);
    return () => clearInterval(timer);
  }, []);

  return {
    todayStr: today(),
    timeStr,
    greeting
  };
}
