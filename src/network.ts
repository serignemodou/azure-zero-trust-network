import * as network from "@pulumi/azure-native/network";
import * as pulumi from "@pulumi/pulumi";

import { resourcesGroup, env, location, projectName, tags } from './common';

interface VnetParams {
    vnetAddressPrefixes: string,
    snAddressPrefixes: string
}

const vnetParams = new pulumi.Config('vnet').requireObject<VnetParams>('params')

const vnetName = `vnet-${projectName}-${env}`
const virtualNetwork = new network.VirtualNetwork(vnetName, {
    resourceGroupName: resourcesGroup.name,
    location: location,
    virtualNetworkName: vnetName,
    addressSpace: {
        addressPrefixes: [
            vnetParams.vnetAddressPrefixes
        ]
    },
    tags: tags
})

const subnetName = `sn-${projectName}-${env}`
export const subnet = new network.Subnet(subnetName, {
    resourceGroupName: resourcesGroup.name,
    subnetName: subnetName,
    virtualNetworkName: virtualNetwork.name,
    addressPrefix: vnetParams.snAddressPrefixes,
    privateEndpointNetworkPolicies: network.VirtualNetworkPrivateEndpointNetworkPolicies.Enabled
})