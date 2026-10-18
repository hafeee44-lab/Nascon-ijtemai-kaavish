import React from 'react';
import {View} from 'react-native-web';
export const SafeAreaProvider=({children}:any)=><View style={{flex:1}}>{children}</View>;
export const SafeAreaView=({edges,...props}:any)=><View {...props}/>;
