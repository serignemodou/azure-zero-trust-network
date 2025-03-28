import * as keyvault from "@pulumi/azure-native/keyvault";
import * as network from "@pulumi/azure-native/network";

import {resourcesGroup, env, projectName, location, tags, tenantID} from "./common";
import {subnet} from "./network";

const regEx = /-/gs
const kvName = `kv-${projectName}-${env}`
let keyVaultName = kvName.replace(regEx, '')

if (keyVaultName.length > 24) {
    const nbr = keyVaultName.length - 24
    keyVaultName = keyVaultName.substring(0, keyVaultName.length - nbr).substring(0, 24)
}

export const keyVault = new keyvault.Vault(keyVaultName, {
    vaultName: keyVaultName,
    resourceGroupName: resourcesGroup.name,
    location: location,
    properties: {
        tenantId: tenantID,
        sku: {
            name: keyvault.SkuName.Standard,
            family: keyvault.SkuFamily.A
        },
        enableRbacAuthorization: true,
        publicNetworkAccess: keyvault.PublicNetworkAccess.Disabled,
        enablePurgeProtection: true,
        softDeleteRetentionInDays: 7,
        enableSoftDelete: false,
    },
    tags: tags
})

const peName = `pe-kv-${projectName}-${env}`
new network.PrivateEndpoint(peName, {
    resourceGroupName: resourcesGroup.name,
    location: location,
    subnet: subnet.id,
    privateLinkServiceConnections: [{
        name: peName,
        privateLinkServiceId: keyVault.id
    }],
    tags: tags
})