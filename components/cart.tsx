"use client";
import {createContext,useContext,useState} from "react";
type C={items:Record<string,number>;add:(id:string)=>void;dec:(id:string)=>void;clear:()=>void;count:number};
const Ctx=createContext<C>(null!);
export const useCart=()=>useContext(Ctx);
export function CartProvider({children}:{children:React.ReactNode}){
const [items,set]=useState<Record<string,number>>({});
const add=(id:string)=>set(s=>({...s,[id]:(s[id]||0)+1}));
const dec=(id:string)=>set(s=>{const n={...s,[id]:(s[id]||0)-1};if(n[id]<=0)delete n[id];return n});
return <Ctx.Provider value={{items,add,dec,clear:()=>set({}),count:Object.values(items).reduce((a,b)=>a+b,0)}}>{children}</Ctx.Provider>}
